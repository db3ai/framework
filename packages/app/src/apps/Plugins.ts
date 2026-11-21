import { ActiveRecord } from '../db';
import type { App } from '../server/App';
import { AppActivation } from './AppActivation';
import { AppRouteError } from './AppRouteError';
import type { AppDefinition, PluginScope, PluginState } from './contracts';

/** Announced after a plugin is turned on or off for a scope, for a parent app, billing or the browser. */
export class PluginChanged {
	/** Records which plugin changed, where, to which state and who changed it. */
	constructor(
		readonly appId: string,
		readonly scope: PluginScope,
		readonly on: boolean,
		readonly actorId: string,
	) {}
}

/** A turn-on the host may refuse, by throwing an AppRouteError, before anything is saved. */
export interface PluginTurnOn {
	appId: string;
	scope: PluginScope;
	actorId: string;
}

/** What the switchboard needs from the app registry. */
export interface PluginRegistry {
	ids(): readonly string[];
	definition(id: string): AppDefinition<any> | undefined;
	service(id: string): unknown;
}

/** Finds the scope that holds another, such as a hosted app's organization. */
export type PluginScopeParent = (id: string) => PluginScope | undefined | Promise<PluginScope | undefined>;

/**
 * Turns plugin apps on and off per scope. The database row is the only state, so every process
 * agrees; a refresh reads it again. Billing is not its concern: a parent app listens for
 * PluginChanged, or the plugin calls billing from its own hooks.
 * @example await app().apps.plugins.turnOn('security_ai', { type: 'app', id: appId }, actor);
 */
export class Plugins {
	readonly #host: App;
	readonly #registry: PluginRegistry;
	readonly #parents = new Map<string, PluginScopeParent>();
	readonly #checks = new Set<(change: PluginTurnOn) => void | Promise<void>>();

	/** Built by the app registry; reach it as `app().apps.plugins`. */
	constructor(host: App, registry: PluginRegistry) {
		this.#host = host;
		this.#registry = registry;
	}

	/** Says which scope holds a scope of this type, so a plugin of an outer scope (an organization) answers inside it (an app). */
	parent(type: string, resolve: PluginScopeParent): void {
		this.#parents.set(type, resolve);
	}

	/** Adds a host check that may refuse a turn-on, such as no card on file; returns its removal. */
	check(check: (change: PluginTurnOn) => void | Promise<void>): () => void {
		this.#checks.add(check);
		return () => { this.#checks.delete(check); };
	}

	/** Whether an app works at this scope: always for a booted non-plugin, else its switch and every required plugin's. */
	async isOn(appId: string, scope: PluginScope): Promise<boolean> {
		return this.#db(() => this.#isOn(appId, scope, new Map()));
	}

	/** Every booted plugin that reaches this scope, with its state at its own scope. */
	async list(scope: PluginScope): Promise<PluginState[]> {
		return this.#db(async () => {
			const rows = new Map<string, boolean>();
			const states: PluginState[] = [];
			for (const appId of this.#registry.ids()) {
				const plugin = this.#registry.definition(appId)?.manifest.plugin;
				if (!plugin || this.#registry.service(appId) === undefined) continue;
				const at = await this.#at(scope, plugin.scope);
				if (at) states.push({ appId, scope: at, on: await this.#isOn(appId, at, rows) });
			}
			return states;
		});
	}

	/** Turns a plugin on at its own scope once its required plugins are on and no check refuses. */
	async turnOn(appId: string, scope: PluginScope, actor: { id: string }): Promise<PluginState> {
		return this.#db(async () => {
			const { definition, service } = this.#plugin(appId, scope);
			if (await this.#isOn(appId, scope, new Map())) return { appId, scope, on: true };
			for (const required of Object.keys(definition.manifest.requires ?? {})) {
				if (!await this.#isOn(required, scope, new Map())) throw new AppRouteError(409, `Turn on ${this.#name(required)} first.`);
			}
			for (const check of this.#checks) await check({ appId, scope, actorId: actor.id });
			await definition.turningOn?.(scope, service);
			await this.#change(appId, scope, true, actor.id, () => definition.turnedOn?.(scope, service));
			return { appId, scope, on: true };
		});
	}

	/** Turns a plugin off at its own scope, refusing while a plugin that requires it is on inside that scope. */
	async turnOff(appId: string, scope: PluginScope, actor: { id: string }): Promise<PluginState> {
		return this.#db(async () => {
			const { definition, service } = this.#plugin(appId, scope);
			if (!await this.#own(appId, scope, new Map())) return { appId, scope, on: false };
			const using = await this.#dependantsOn(appId, scope);
			if (using.length) throw new AppRouteError(409, `Turn off ${using.map(id => this.#name(id)).join(', ')} first.`);
			await this.#change(appId, scope, false, actor.id, () => definition.turnedOff?.(scope, service));
			return { appId, scope, on: false };
		});
	}

	/** The route gate: a plugin answers only where its scope parameter names a scope it is on for. */
	async allows(appId: string, params: Readonly<Record<string, string | undefined>>): Promise<boolean> {
		const plugin = this.#registry.definition(appId)?.manifest.plugin;
		if (!plugin) return true;
		const id = params[plugin.scope];
		return Boolean(id) && this.isOn(appId, { type: plugin.scope, id: id! });
	}

	/** Effective state: booted, its own switch, and every required plugin's. Rows read once per call. */
	async #isOn(appId: string, scope: PluginScope, rows: Map<string, boolean>): Promise<boolean> {
		const definition = this.#registry.definition(appId);
		if (!definition || this.#registry.service(appId) === undefined) return false;
		if (!definition.manifest.plugin) return true;
		const at = await this.#at(scope, definition.manifest.plugin.scope);
		if (!at || !await this.#own(appId, at, rows)) return false;
		for (const required of Object.keys(definition.manifest.requires ?? {})) {
			if (!await this.#isOn(required, at, rows)) return false;
		}
		return true;
	}

	/** The plugin's own switch at exactly this scope: its row, else the manifest default. */
	async #own(appId: string, scope: PluginScope, rows: Map<string, boolean>): Promise<boolean> {
		const key = keyOf(appId, scope);
		if (!rows.has(key)) {
			const row = await this.#hasTable() ? await AppActivation.where('key', key).first() : undefined;
			rows.set(key, row ? Boolean(row.on) : this.#registry.definition(appId)?.manifest.plugin?.default === 'on');
		}
		return rows.get(key)!;
	}

	/** Plugins that require this one and are switched on somewhere inside this scope. */
	async #dependantsOn(appId: string, scope: PluginScope): Promise<string[]> {
		const using: string[] = [];
		for (const id of this.#registry.ids()) {
			const manifest = this.#registry.definition(id)?.manifest;
			if (!manifest?.plugin || manifest.requires?.[appId] === undefined) continue;
			const rows = await AppActivation.where({ appId: id, on: true }).all();
			let inside = false;
			for (const row of rows) {
				const holder = await this.#at({ type: row.scopeType, id: row.scopeId }, scope.type);
				if (holder?.id === scope.id) { inside = true; break; }
			}
			if (!inside && manifest.plugin.default === 'on' && manifest.plugin.scope === scope.type) inside = await this.#own(id, scope, new Map());
			if (inside) using.push(id);
		}
		return using;
	}

	/** Walks out from a scope to the one of the given type, if the host said how. */
	async #at(scope: PluginScope, type: string): Promise<PluginScope | undefined> {
		let current: PluginScope | undefined = scope;
		for (let depth = 0; current && depth < 8; depth++) {
			if (current.type === type) return current;
			const parent = this.#parents.get(current.type);
			current = parent ? await parent(current.id) : undefined;
		}
		return undefined;
	}

	/** A booted plugin switched at its own scope type, or a clear refusal. */
	#plugin(appId: string, scope: PluginScope) {
		const definition = this.#registry.definition(appId);
		const service = this.#registry.service(appId);
		if (!definition?.manifest.plugin || service === undefined) throw new AppRouteError(404, 'Plugin not found.');
		if (scope?.type !== definition.manifest.plugin.scope || typeof scope.id !== 'string' || !scope.id || scope.id.length > 120) throw new AppRouteError(400, `${definition.manifest.name} is switched per ${definition.manifest.plugin.scope}.`);
		return { definition, service };
	}

	/**
	 * Flips the switch, then runs the plugin's hook and announces it. Only the caller whose write
	 * actually changed the row runs them, so overlapping calls start or stop work once. If the hook
	 * or a listener fails, the switch goes back and the error is thrown, so a retry runs them again.
	 */
	async #change(appId: string, scope: PluginScope, on: boolean, actorId: string, hook: () => unknown): Promise<void> {
		if (!await this.#flip(appId, scope, on, actorId)) return;
		try {
			await hook();
			await this.#host.events.dispatch(new PluginChanged(appId, scope, on, actorId));
		} catch (error) {
			await this.#flip(appId, scope, !on, actorId);
			throw error;
		}
	}

	/** Writes the switch only if it is not already in that state; true when this call changed it. */
	async #flip(appId: string, scope: PluginScope, on: boolean, actorId: string): Promise<boolean> {
		if (!await this.#hasTable()) throw new Error('Install an app to create db3_app_activations before switching plugins.');
		const key = keyOf(appId, scope);
		const table = this.#host.db.knex(AppActivation.table);
		if (await table.clone().where({ key, on: !on }).update({ on, changed_by: actorId, changed_at: new Date() })) return true;
		if (await table.clone().where({ key }).first()) return false;
		try {
			await AppActivation.create({ key, appId, scopeType: scope.type, scopeId: scope.id, on, changedBy: actorId }).save();
			return true;
		} catch (error) {
			// Another call created the row first; it owns this change.
			if ((error as { code?: string }).code === 'ER_DUP_ENTRY' || (error as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY') return false;
			throw error;
		}
	}

	/** A plugin's display name for messages people read. */
	#name(appId: string): string {
		return this.#registry.definition(appId)?.manifest.name ?? appId;
	}

	/** Hosts that never installed an app have no switch table; every plugin then sits at its default. */
	async #hasTable(): Promise<boolean> {
		return this.#host.db.knex.schema.hasTable(AppActivation.table);
	}

	/** Runs on the host database outside any caller's transaction. */
	#db<T>(operation: () => Promise<T>): Promise<T> {
		return ActiveRecord.withDb(this.#host.db.knex, operation);
	}
}

/** The one row a switch lives in: app, scope type and scope id. */
function keyOf(appId: string, scope: PluginScope): string {
	return `${appId}:${scope.type}:${scope.id}`;
}
