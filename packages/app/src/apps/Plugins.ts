import { ActiveRecord } from '../db';
import type { App } from '../server/App';
import { PluginActivation } from './PluginActivation';
import { AppRouteError } from './AppRouteError';
import type { SubAppDefinition, PluginScope, PluginState } from './contracts';

/** Announced after a plugin is activated or deactivated for a scope, for a parent app, billing or the browser. */
export class PluginChanged {
	/** Records which plugin changed, where, to which state and who changed it. */
	constructor(
		readonly appId: string,
		readonly scope: PluginScope,
		readonly active: boolean,
		readonly actorId: string,
	) {}
}

/** An activation the main app may refuse, by throwing an AppRouteError, before anything is saved. */
export interface PluginActivationRequest {
	appId: string;
	scope: PluginScope;
	actorId: string;
}

/** What the switchboard needs from the app registry. */
export interface PluginRegistry {
	ids(): readonly string[];
	definition(id: string): SubAppDefinition<any> | undefined;
	service(id: string): unknown;
}

/** Finds the scope that holds another, such as a hosted app's organization. */
export type PluginScopeParent = (id: string) => PluginScope | undefined | Promise<PluginScope | undefined>;

/**
 * Activates and deactivates plugins per scope. The database row is the only state, so every process
 * agrees; a refresh reads it again. Billing is not its concern: a parent app listens for
 * PluginChanged, or the plugin calls billing from its own hooks.
 * @example await app().apps.plugins.activate('security_ai', { type: 'app', id: appId }, actor);
 */
export class Plugins {
	readonly #host: App;
	readonly #registry: PluginRegistry;
	readonly #parents = new Map<string, PluginScopeParent>();
	readonly #checks = new Set<(change: PluginActivationRequest) => void | Promise<void>>();

	/** Built by the app registry; reach it as `app().apps.plugins`. */
	constructor(host: App, registry: PluginRegistry) {
		this.#host = host;
		this.#registry = registry;
	}

	/** Says which scope holds a scope of this type, so a plugin of an outer scope (an organization) answers inside it (an app). */
	parent(type: string, resolve: PluginScopeParent): void {
		this.#parents.set(type, resolve);
	}

	/** Adds a main app check that may refuse an activation, such as no card on file; returns its removal. */
	check(check: (change: PluginActivationRequest) => void | Promise<void>): () => void {
		this.#checks.add(check);
		return () => { this.#checks.delete(check); };
	}

	/** Whether an app works at this scope: always for a booted non-plugin, else its activation and every required plugin's. */
	async isActive(appId: string, scope: PluginScope): Promise<boolean> {
		return this.#db(() => this.#isActive(appId, scope, new Map()));
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
				if (at) states.push({ appId, scope: at, active: await this.#isActive(appId, at, rows) });
			}
			return states;
		});
	}

	/** Activates a plugin at its own scope once its required plugins are on and no check refuses. */
	async activate(appId: string, scope: PluginScope, actor: { id: string }): Promise<PluginState> {
		return this.#db(async () => {
			const { definition, service } = this.#plugin(appId, scope);
			if (await this.#isActive(appId, scope, new Map())) return { appId, scope, active: true };
			for (const required of Object.keys(definition.manifest.requires ?? {})) {
				if (!await this.#isActive(required, scope, new Map())) throw new AppRouteError(409, `Activate ${this.#name(required)} first.`);
			}
			for (const check of this.#checks) await check({ appId, scope, actorId: actor.id });
			await definition.activating?.(scope, service);
			await this.#change(appId, scope, true, actor.id, () => definition.activated?.(scope, service));
			return { appId, scope, active: true };
		});
	}

	/** Deactivates a plugin at its own scope, refusing while a plugin that requires it is active inside that scope. */
	async deactivate(appId: string, scope: PluginScope, actor: { id: string }): Promise<PluginState> {
		return this.#db(async () => {
			const { definition, service } = this.#plugin(appId, scope);
			if (!await this.#own(appId, scope, new Map())) return { appId, scope, active: false };
			const using = await this.#dependantsOn(appId, scope);
			if (using.length) throw new AppRouteError(409, `Deactivate ${using.map(id => this.#name(id)).join(', ')} first.`);
			await this.#change(appId, scope, false, actor.id, () => definition.deactivated?.(scope, service));
			return { appId, scope, active: false };
		});
	}

	/** The route gate: a plugin answers only where its scope parameter names a scope it is on for. */
	async allows(appId: string, params: Readonly<Record<string, string | undefined>>): Promise<boolean> {
		const plugin = this.#registry.definition(appId)?.manifest.plugin;
		if (!plugin) return true;
		const id = params[plugin.scope];
		return Boolean(id) && this.isActive(appId, { type: plugin.scope, id: id! });
	}

	/** Effective state: booted, its own activation, and every required plugin's. Rows read once per call. */
	async #isActive(appId: string, scope: PluginScope, rows: Map<string, boolean>): Promise<boolean> {
		const definition = this.#registry.definition(appId);
		if (!definition || this.#registry.service(appId) === undefined) return false;
		if (!definition.manifest.plugin) return true;
		const at = await this.#at(scope, definition.manifest.plugin.scope);
		if (!at || !await this.#own(appId, at, rows)) return false;
		for (const required of Object.keys(definition.manifest.requires ?? {})) {
			if (!await this.#isActive(required, at, rows)) return false;
		}
		return true;
	}

	/** The plugin's own activation at exactly this scope: its row, else the manifest default. */
	async #own(appId: string, scope: PluginScope, rows: Map<string, boolean>): Promise<boolean> {
		const key = keyOf(appId, scope);
		if (!rows.has(key)) {
			const row = await this.#hasTable() ? await PluginActivation.where('key', key).first() : undefined;
			rows.set(key, row ? Boolean(row.active) : this.#registry.definition(appId)?.manifest.plugin?.default === 'on');
		}
		return rows.get(key)!;
	}

	/** Plugins that require this one and are switched on somewhere inside this scope. */
	async #dependantsOn(appId: string, scope: PluginScope): Promise<string[]> {
		const using: string[] = [];
		for (const id of this.#registry.ids()) {
			const manifest = this.#registry.definition(id)?.manifest;
			if (!manifest?.plugin || manifest.requires?.[appId] === undefined) continue;
			const rows = await PluginActivation.where({ appId: id, active: true }).all();
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
	 * Changes the activation, then runs the plugin's hook and announces it. Only the caller whose write
	 * actually changed the row runs them, so overlapping calls start or stop work once. If the hook
	 * or a listener fails, the activation goes back and the error is thrown, so a retry runs them again.
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

	/** Writes the activation only if it is not already in that state; true when this call changed it. */
	async #flip(appId: string, scope: PluginScope, on: boolean, actorId: string): Promise<boolean> {
		if (!await this.#hasTable()) throw new Error('Install an app to create db3_plugin_activations before switching plugins.');
		const key = keyOf(appId, scope);
		const table = this.#host.db.knex(PluginActivation.table);
		if (await table.clone().where({ key, active: !on }).update({ active: on, changed_by: actorId, changed_at: new Date() })) return true;
		if (await table.clone().where({ key }).first()) return false;
		try {
			await PluginActivation.create({ key, appId, scopeType: scope.type, scopeId: scope.id, active: on, changedBy: actorId }).save();
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

	/** Hosts that never installed an app have no activation table; every plugin then sits at its default. */
	async #hasTable(): Promise<boolean> {
		return this.#host.db.knex.schema.hasTable(PluginActivation.table);
	}

	/** Runs on the host database outside any caller's transaction. */
	#db<T>(operation: () => Promise<T>): Promise<T> {
		return ActiveRecord.withDb(this.#host.db.knex, operation);
	}
}

/** The one row an activation lives in: app, scope type and scope id. */
function keyOf(appId: string, scope: PluginScope): string {
	return `${appId}:${scope.type}:${scope.id}`;
}
