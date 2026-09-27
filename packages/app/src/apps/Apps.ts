import { register } from 'tsx/esm/api';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ActiveRecord } from '../db';
import { isQueueableJobClass, queueableJobName } from '../queue';
import type { ScheduledTaskDefinition, ScheduledJobSource } from '../scheduler';
import { databaseDialectForConnection } from '../db/dialects';
import { DatabaseMigrationManager, type RollbackResult } from '../db/migrations';
import type { App } from '../server/App';
import { discoverApps } from './discoverApps';
import { AppService } from './AppService';
import { AppRouteError } from './AppRouteError';
import { AppInstallation } from './AppInstallation';
import { validateAppDefinitions } from './validateAppDefinitions';
import { normalizeAppNavigation } from './normalizeAppNavigation';
import type * as apps from './contracts';

/**
 * Owns discovered or explicit app composition, durable installation and process-local service lifecycle.
 * Installation operations run in a stopped maintenance process; boot never migrates a database.
 */
export class Apps<TDefinitions extends apps.AppDefinitions = {}> {
	readonly #host: App;
	readonly #definitions: Record<string, apps.AppDefinition<any>>;
	readonly #discovered = new Map<string, apps.DiscoveredApp>();
	readonly #loaded = new Set<string>();
	readonly #inFlight = new Set<Promise<unknown>>();
	#changing = false;
	readonly #order: string[];
	readonly #reserved: string[];
	readonly #automatic: boolean;
	readonly #services = new Map<string, unknown>();
	readonly #schedules = new Map<string, ScheduledTaskDefinition[]>();
	readonly #cleanup: Array<() => void | Promise<void>> = [];
	#records = new Map<string, AppInstallation>();
	#booted = false;
	#booting?: Promise<void>;
	#starting = false;

	/** Discovers or validates app definitions and exposes their optional services without executing app code. */
	constructor(host: App, definitions?: TDefinitions) {
		this.#host = host;
		this.#automatic = definitions === undefined;
		this.#definitions = Object.assign(Object.create(null), definitions);
		if (definitions === undefined) {
			for (const found of discoverApps(host.directory)) {
				this.#discovered.set(found.manifest.id, found);
				this.#definitions[found.manifest.id] = { manifest: found.manifest, create: () => { throw new Error('Load the app before creating its service.'); } };
			}
		}
		const reserved = [...Object.getOwnPropertyNames(Apps.prototype), 'then', 'toJSON'];
		for (let prototype: object | null = host; prototype; prototype = Object.getPrototypeOf(prototype)) reserved.push(...Object.getOwnPropertyNames(prototype));
		this.#reserved = reserved;
		this.#order = validateAppDefinitions(this.#definitions, reserved);
		for (const id of this.#order) {
			Object.defineProperty(this, id, { enumerable: true, configurable: true, get: () => this.get(id) });
			Object.defineProperty(host, id, { enumerable: true, configurable: true, get: () => this.get(id) });
		}
	}

	/** Refreshes folder additions and inactive removals without executing newly discovered code. Existing code updates require restart. */
	#refresh(): void {
		if (!this.#automatic) return;
		const sources = discoverApps(this.#host.directory);
		const ids = new Set(sources.map(source => source.manifest.id));
		for (const id of this.#discovered.keys()) {
			if (ids.has(id)) continue;
			if (this.#services.has(id)) throw new Error(`Uninstall app "${id}" before removing its folder or package.`);
			this.#discovered.delete(id);
			this.#loaded.delete(id);
			delete this.#definitions[id];
			Reflect.deleteProperty(this, id);
			Reflect.deleteProperty(this.#host, id);
		}
		for (const source of sources) {
			const id = source.manifest.id;
			if (this.#discovered.has(id)) continue;
			const definition = { manifest: source.manifest, create: () => { throw new Error('Load the app before creating its service.'); } };
			validateAppDefinitions({ ...this.#definitions, [id]: definition }, this.#reserved);
			this.#definitions[id] = definition;
			this.#discovered.set(id, source);
			Object.defineProperty(this, id, { enumerable: true, configurable: true, get: () => this.get(id) });
			Object.defineProperty(this.#host, id, { enumerable: true, configurable: true, get: () => this.get(id) });
		}
		this.#order.splice(0, this.#order.length, ...validateAppDefinitions(this.#definitions, this.#reserved));
	}

	/** Loads a discovered root App class when installation or migration tooling explicitly needs its code. */
	async load(id: string): Promise<void> {
		this.#refresh();
		this.#definition(id);
		const source = this.#discovered.get(id);
		if (!source || this.#loaded.has(id)) return;
		const unregister = source.entry.endsWith('.ts') ? register() : undefined;
		let Service: typeof AppService;
		try { ({ default: Service } = await import(pathToFileURL(source.entry).href)); }
		finally { await unregister?.(); }
		if (typeof Service !== 'function' || !(Service.prototype instanceof AppService)) throw new Error(`App "${id}" must default-export a class extending AppService.`);
		this.#definitions[id] = {
			manifest: source.manifest,
			create: host => new Service(host),
			...(Service.models.length ? { database: { models: Service.models, directory: pathToFileURL(join(dirname(source.entry), 'database') + '/') } } : {}),
			routes: Service.routes,
			jobs: Service.jobs,
			...(Service.prototype.schedule !== AppService.prototype.schedule ? { schedule: (schedule, service) => service.schedule(schedule) } satisfies Pick<apps.AppDefinition<AppService>, 'schedule'> : {}),
			navigation: (context, service) => service.navigation(context),
			start: context => context.service.start(context),
			afterInstall: host => new Service(host).install(),
			beforeUninstall: host => new Service(host).uninstall(),
		};
		validateAppDefinitions(this.#definitions, []);
		this.#loaded.add(id);
	}

	/** Executes a request under the lifecycle gate so management waits for active app requests to finish. */
	async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#changing) throw new AppRouteError(503, 'Apps are being updated. Please try again shortly.');
		const pending = Promise.resolve().then(operation);
		this.#inFlight.add(pending);
		try { return await pending; } finally { this.#inFlight.delete(pending); }
	}

	/**
	 * Applies an explicitly authorized action in a single-process host, draining app requests and restarting resources.
	 * Multi-process hosts must quiesce every process and use the stopped-runtime CLI instead.
	 */
	async manage(action: apps.AppAction, id: string): Promise<apps.AppDescription[]> {
		if (!['install', 'enable', 'disable', 'uninstall'].includes(action)) throw new Error('Unknown app action.');
		if (this.#changing) throw new AppRouteError(409, 'Another app operation is running.');
		this.#changing = true;
		try {
			await Promise.allSettled([...this.#inFlight]);
			await this.load(id);
			await this.#assertNoPendingWork(id);
			await this.close();
			try { await this[action](id); } finally { await this.boot(); }
			return await this.describe();
		} finally { this.#changing = false; }
	}

	/** Returns an available app service, or undefined when absent, disabled or not booted. */
	get<K extends keyof TDefinitions & string>(id: K): apps.AppServices<TDefinitions>[K];
	get(id: string): unknown;
	get(id: string): unknown {
		return this.#booted || this.#starting ? this.#services.get(id) : undefined;
	}

	/** Returns a required ready service, rejecting use before boot or after disable/removal. */
	require<K extends keyof TDefinitions & string>(id: K): NonNullable<apps.AppServices<TDefinitions>[K]>;
	require(id: string): unknown;
	require(id: string): unknown {
		const service = this.get(id);
		if (service === undefined) throw new Error(`App "${id}" is not ready. Install, enable and boot it first.`);
		return service;
	}

	/** Lists browser-safe definitions and retained installations for visual exploration or CLI use. */
	async describe(): Promise<apps.AppDescription[]> {
		this.#refresh();
		await this.#readRecords();
		const ids = new Set([...this.#order, ...this.#records.keys()]);
		return [...ids].map(id => this.#description(id));
	}

	/**
	 * Collects fresh navigation from ready apps for a host-authenticated viewer, under the lifecycle gate.
	 * Provider failures omit only that app. Undefined uses manifest links; null intentionally hides it.
	 * @example await host.apps.navigation({ actor: { id: verifiedUser.id } });
	 */
	async navigation(context: apps.AppNavigationContext): Promise<apps.AppNavigationResult> {
		if (typeof context?.actor?.id !== 'string' || !context.actor.id.trim()) throw new AppRouteError(401, 'Please sign in.');
		if (context.organisationId !== undefined && (typeof context.organisationId !== 'string' || !context.organisationId.trim())) throw new AppRouteError(400, 'Invalid organisation scope.');
		const viewer = Object.freeze({ actor: Object.freeze({ id: context.actor.id }), ...(context.organisationId === undefined ? {} : { organisationId: context.organisationId }) });
		return this.run(async () => {
			const ids = this.#booted ? this.#order.filter(id => this.#services.has(id)) : [];
			const results = await ActiveRecord.withDb(this.#host.db.knex, () => Promise.allSettled(ids.map(async appId => {
				const definition = this.#definitions[appId];
				const contribution = await definition.navigation?.(viewer, this.#services.get(appId));
				if (contribution === null) return null;
				const navigation = normalizeAppNavigation(contribution ?? { items: definition.manifest.navigation ?? [] });
				return { ...navigation, appId, name: definition.manifest.name, ...(definition.manifest.icon === undefined ? {} : { icon: definition.manifest.icon }) };
			})));
			const result: apps.AppNavigationResult = { apps: [], unavailable: [] };
			results.forEach((entry, index) => {
				if (entry.status === 'rejected') {
					result.unavailable.push(ids[index]);
					this.#host.log.warn({ appId: ids[index], err: entry.reason }, 'App navigation provider failed.');
				}
				else if (entry.value) result.apps.push(entry.value);
			});
			return result;
		});
	}

	/** Returns explicit route contributions for transport adapters, including currently disabled apps. */
	routes(): { appId: string; route: apps.AppRoute<any> }[] {
		return this.#order.flatMap(appId => (this.#definitions[appId].routes ?? []).map(route => ({ appId, route })));
	}

	/** Validates the durable desired state and starts enabled apps in dependency order without schema changes. */
	async boot(): Promise<void> {
		if (this.#booted) return;
		if (this.#booting) return this.#booting;
		this.#booting = this.#boot();
		try { await this.#booting; } finally { this.#booting = undefined; }
	}

	/** Creates or upgrades an installation using committed migrations; existing business data is preserved. */
	async install(id: string): Promise<apps.AppDescription> {
		return this.#maintain(async () => {
			await this.load(id);
			const definition = this.#definition(id);
			this.#assertDependencies(id);
			for (const Model of definition.database?.models ?? []) {
				for (const [ownerId, installation] of this.#records) {
					if (ownerId !== id && installation.description.models.some(model => model.table === Model.table)) throw new Error(`Table "${Model.table}" is retained by app "${ownerId}".`);
				}
			}
			const existing = this.#records.get(id);
			if (existing) await this.#assertNoPendingWork(id);
			if (existing && compareVersions(definition.manifest.version, existing.version) < 0) throw new Error(`Refusing to downgrade "${id}" from ${existing.version}.`);
			const hashes = await this.#migrationHashes(id);
			for (const [file, hash] of Object.entries(existing?.migrationHashes ?? {})) {
				if (hashes[file] !== hash) throw new Error(`Immutable migration "${id}/${file}" was removed or changed.`);
			}
			const record = existing ?? AppInstallation.create({ appId: id });
			record.assign({ version: definition.manifest.version, state: 'failed', description: this.#description(id), migrationHashes: hashes });
			await record.save();
			this.#records.set(id, record);
			const manager = this.migrations(id);
			if (manager) {
				await manager.migrate();
				if (!(await manager.check()).matches) throw new Error(`Schema check failed for "${id}". Installation remains failed; correct the package and retry.`);
			}
			await definition.afterInstall?.(this.#host);
			record.state = 'enabled';
			await record.save();
			return this.#description(id);
		});
	}

	/** Re-enables a retained installation after validating its code, schema and required dependencies. */
	async enable(id: string): Promise<apps.AppDescription> {
		return this.#maintain(async () => {
			await this.load(id);
			const record = this.#installed(id);
			this.#assertVersion(id, record);
			this.#assertDependencies(id);
			const manager = this.migrations(id);
			if (manager && !(await manager.check()).matches) throw new Error(`App "${id}" requires installation or upgrade before enabling.`);
			record.state = 'enabled';
			await record.save();
			return this.#description(id);
		});
	}

	/** Disables an app for the next boot, retaining its schema, migration ledger and business data. */
	async disable(id: string): Promise<apps.AppDescription> {
		return this.#maintain(async () => {
			await this.load(id);
			const record = this.#installed(id);
			this.#assertNoDependants(id, true);
			await this.#assertNoPendingWork(id);
			record.state = 'disabled';
			await record.save();
			return this.#description(id);
		});
	}

	/** Deregisters a durable installation while retaining data and ownership history; never drops tables. */
	async uninstall(id: string): Promise<apps.AppDescription> {
		return this.#maintain(async () => {
			await this.load(id);
			const record = this.#records.get(id);
			if (!record || record.state === 'uninstalled') return this.#description(id);
			this.#assertNoDependants(id, false);
			await this.#assertNoPendingWork(id);
			await this.#definitions[id].beforeUninstall?.(this.#host);
			record.state = 'uninstalled';
			await record.save();
			return this.#description(id);
		});
	}

	/**
	 * Runs one app-owned down migration after disable, preserving ownership and migration fingerprints.
	 * This explicit operation may delete data. The installation requires install() before it can run again.
	 */
	async rollback(id: string): Promise<RollbackResult> {
		return this.#maintain(async () => {
			await this.load(id);
			const record = this.#records.get(id);
			if (!record || record.state === 'enabled') throw new Error('Disable the app before rolling back its migration.');
			this.#assertNoDependants(id, false);
			await this.#assertNoPendingWork(id);
			const hashes = await this.#migrationHashes(id);
			for (const [file, hash] of Object.entries(record.migrationHashes)) {
				if (hashes[file] !== hash) throw new Error(`Immutable migration "${id}/${file}" was removed or changed.`);
			}
			const manager = this.migrations(id);
			if (!manager) throw new Error(`App "${id}" has no database definition.`);
			record.state = 'failed';
			await record.save();
			return manager.rollback();
		});
	}

	/** Returns a separately namespaced migration manager; app schemas never enter the host snapshot. */
	migrations(id: string): DatabaseMigrationManager | undefined {
		const database = this.#definition(id).database;
		if (!database) return undefined;
		const directory = fileURLToPath(database.directory);
		return new DatabaseMigrationManager({
			db: this.#host.db.knex, dialect: databaseDialectForConnection(this.#host.db.knex), models: database.models,
			migrationsDirectory: join(directory, 'migrations'), snapshotFile: join(directory, 'schema.snapshot.json'),
			migrationTableName: `db3_app_${id}_migrations`, loadExtensions: ['.mjs'], migrationExtension: '.mjs',
		});
	}

	/** Releases all owned resources in reverse order; attempts every cleanup even after a failure. */
	async close(): Promise<void> {
		if (this.#booting) await this.#booting.catch(() => undefined);
		await this.#dispose();
	}

	/** Starts services only after all installed definitions, versions and schemas have passed validation. */
	async #boot(): Promise<void> {
		this.#refresh();
		await this.#readRecords();
		for (const [id, record] of this.#records) {
			if (record.state !== 'enabled') continue;
			await this.load(id);
			this.#assertVersion(id, record);
			this.#assertDependencies(id);
			const manager = this.migrations(id);
			if (manager && !(await manager.check()).matches) throw new Error(`App "${id}" has pending or incompatible migrations; run apps:install in maintenance mode.`);
		}
		this.#starting = true;
		try {
			for (const id of this.#order) {
				if (this.#records.get(id)?.state !== 'enabled') continue;
				const definition = this.#definitions[id];
				const service = definition.create(this.#host);
				if (service == null || typeof service?.then === 'function') throw new Error(`App "${id}" must synchronously create a service; use start() for async work.`);
				this.#services.set(id, service);
				this.#registerBackgroundWork(id, definition, service);
				await definition.start?.({ host: this.#host, service, defer: cleanup => { this.#cleanup.push(cleanup); } });
			}
			this.#booted = true;
		} catch (error) {
			try { await this.#dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'App startup and cleanup failed.'); }
			throw error;
		} finally { this.#starting = false; }
	}

	/** Registers declared jobs and schedules together, with automatic reverse-order cleanup and lifecycle admission. */
	#registerBackgroundWork(id: string, definition: apps.AppDefinition<any>, service: unknown): void {
		const jobs = definition.jobs ?? [];
		const names = new Set(jobs.map(queueableJobName));
		if (jobs.length) this.#cleanup.push(this.#host.queue.registerJobs(id, jobs, operation => this.run(() => ActiveRecord.withDb(this.#host.db.knex, operation))));
		if (!definition.schedule) return;
		const registration = this.#host.scheduler.register(id, scope => definition.schedule!({
			/** Ensures declared classes and factory results can be reconstructed by independently booted workers. */
			job: source => {
				if (isQueueableJobClass(source)) {
					if (!names.has(queueableJobName(source))) throw new Error(`Scheduled job must be declared in app "${id}" jobs.`);
					return scope.job(source as ScheduledJobSource);
				}
				return scope.job(() => {
					const job = source();
					if (!jobs.includes(job.constructor as typeof jobs[number])) throw new Error(`Scheduled factory returned an undeclared job in "${id}".`);
					return job;
				});
			},
			call: handler => scope.call(handler),
		}, service), operation => this.run(() => ActiveRecord.withDb(this.#host.db.knex, operation)));
		this.#cleanup.push(registration.close);
		this.#schedules.set(id, registration.definitions);
	}

	/** Refuses to strand active, delayed or chained jobs. All producers and workers must be quiesced for CLI maintenance. */
	async #assertNoPendingWork(id: string): Promise<void> {
		if (!(this.#definitions[id]?.jobs?.length || this.#records.get(id)?.description.jobs?.length)) return;
		if (await this.#host.queue.hasPendingJobs(`${id}.`)) throw new AppRouteError(409, `App "${id}" has outstanding jobs. Stop scheduling and drain its queue before changing the installation.`);
	}

	/** Clears services even if a disposer fails; no app stays publicly available after shutdown. */
	async #dispose(): Promise<void> {
		const errors: unknown[] = [];
		for (const cleanup of this.#cleanup.splice(0).reverse()) {
			try { await cleanup(); } catch (error) { errors.push(error); }
		}
		this.#services.clear();
		this.#booted = false;
		if (errors.length) throw new AggregateError(errors, 'App cleanup failed.');
	}

	/** Serializes installation changes across maintenance processes using a database-specific advisory lock. */
	async #maintain<T>(operation: () => Promise<T>): Promise<T> {
		if (this.#booted || this.#booting) throw new Error('Stop app runtimes before changing installations. Use a fresh maintenance process or explicitly authorized single-process manage().');
		const db = this.#host.db.knex;
		const connection = await db.client.acquireConnection();
		let lock: string | undefined;
		try {
			const [rows] = await db.raw('SELECT DATABASE() AS name').connection(connection);
			lock = `db3_apps_${createHash('sha256').update(String(rows[0].name)).digest('hex').slice(0, 32)}`;
			const [acquired] = await db.raw('SELECT GET_LOCK(?, 10) AS acquired', [lock]).connection(connection);
			if (Number(acquired[0].acquired) !== 1) throw new Error('Another app installation operation holds the maintenance lock.');
			return await ActiveRecord.withDb(db, async () => {
				await this.#host.db.install(AppInstallation);
				await this.#readRecords();
				return operation();
			});
		} finally {
			try { if (lock) await db.raw('SELECT RELEASE_LOCK(?)', [lock]).connection(connection); }
			finally { await db.client.releaseConnection(connection); }
		}
	}

	/** Reads installation metadata without creating tables or changing the database. */
	async #readRecords(): Promise<void> {
		if (!(await this.#host.db.knex.schema.hasTable(AppInstallation.table))) { this.#records.clear(); return; }
		const records = await ActiveRecord.withDb(this.#host.db.knex, () => AppInstallation.query().all());
		this.#records = new Map(records.map(record => [record.appId, record]));
	}

	/** Resolves a registered definition with an actionable error for removed enabled packages. */
	#definition(id: string): apps.AppDefinition<any> {
		const definition = Object.hasOwn(this.#definitions, id) ? this.#definitions[id] : undefined;
		if (!definition) throw new Error(`App "${id}" is not registered. Restore its code or uninstall it before removing registration.`);
		return definition;
	}

	/** Requires retained installed state before enable or disable operations. */
	#installed(id: string): AppInstallation {
		this.#definition(id);
		const record = this.#records.get(id);
		if (!record || record.state === 'uninstalled' || record.state === 'failed') throw new Error(`App "${id}" must be installed first.`);
		return record;
	}

	/** Prevents unreviewed package updates from taking effect merely because node_modules changed. */
	#assertVersion(id: string, record: AppInstallation): void {
		if (this.#definition(id).manifest.version !== record.version) throw new Error(`App "${id}" package version changed; run apps:install before boot.`);
	}

	/** Checks required and present optional service contracts against enabled compatible installations. */
	#assertDependencies(id: string): void {
		const manifest = this.#definition(id).manifest;
		for (const [dependency, generation] of Object.entries({ ...manifest.requires, ...manifest.optional })) {
			const record = this.#records.get(dependency);
			if (record?.state !== 'enabled') {
				if (manifest.requires?.[dependency] !== undefined) throw new Error(`App "${id}" requires enabled app "${dependency}".`);
				continue;
			}
			if ((this.#definition(dependency).manifest.apiVersion ?? 1) !== generation) throw new Error(`App "${id}" requires API generation ${generation} of "${dependency}".`);
		}
		for (const [consumerId, record] of this.#records) {
			if (record.state !== 'enabled' || consumerId === id) continue;
			const dependency = { ...record.description.manifest.requires, ...record.description.manifest.optional }[id];
			if (dependency !== undefined && dependency !== (manifest.apiVersion ?? 1)) throw new Error(`App "${consumerId}" requires API generation ${dependency} of "${id}".`);
		}
	}

	/** Prevents required dependants from being stranded by disable or uninstall. */
	#assertNoDependants(id: string, enabledOnly: boolean): void {
		for (const [consumerId, record] of this.#records) {
			if (record.state === 'uninstalled' || (enabledOnly && record.state !== 'enabled')) continue;
			if (record.description.manifest.requires?.[id] !== undefined) throw new Error(`App "${consumerId}" depends on "${id}"; ${enabledOnly ? 'disable' : 'uninstall'} it first.`);
		}
	}

	/** Retains immutable migration fingerprints independently of removable package files. */
	async #migrationHashes(id: string): Promise<Record<string, string>> {
		const database = this.#definition(id).database;
		if (!database) return {};
		const directory = join(fileURLToPath(database.directory), 'migrations');
		const hashes: Record<string, string> = {};
		for (const file of (await readdir(directory)).filter(file => file.endsWith('.mjs')).sort()) {
			hashes[file] = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
		}
		return hashes;
	}

	/** Projects source or retained metadata to a serializable description with current installation state. */
	#description(id: string): apps.AppDescription {
		const definition = this.#definitions[id];
		const record = this.#records.get(id);
		const source = definition ? {
			manifest: definition.manifest,
			models: definition.database ? definition.database.models.map(Model => ({ name: Model.name, table: Model.table })) : record?.description.models ?? [],
			routes: definition.routes ? definition.routes.map(route => ({ method: route.method, path: `/api/apps/${id}${route.path === '/' ? '' : route.path}` })) : record?.description.routes ?? [],
			jobs: definition.jobs ? definition.jobs.map(queueableJobName) : record?.description.jobs ?? [],
			schedules: this.#schedules.get(id) ?? record?.description.schedules ?? [],
		} : record!.description;
		return structuredClone({ ...source, jobs: source.jobs ?? [], schedules: source.schedules ?? [], registered: Boolean(definition), state: record?.state ?? 'available', ready: this.#booted && this.#services.has(id), installedVersion: record?.version ?? null });
	}
}

/** Compares stable semantic release versions already validated by the definition boundary. */
function compareVersions(left: string, right: string): number {
	const a = left.split('.').map(Number);
	const b = right.split('.').map(Number);
	for (let index = 0; index < 3; index++) { if (a[index] !== b[index]) return a[index] - b[index]; }
	return 0;
}
