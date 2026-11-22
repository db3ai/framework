/**
 * Makes a sub app a plugin: something each scope, such as an organization or a hosted app,
 * activates and deactivates. Activation only stores the state and announces it; it knows nothing of billing.
 */
export interface SubAppPlugin {
	/**
	 * What one switch covers, named like the route parameter that carries it: `organization`
	 * covers `:organization`. Every route of the plugin must have that parameter.
	 */
	scope: string;
	/** `on`: active until someone deactivates it. `off` (the default): inactive until someone activates it. */
	default?: 'on' | 'off';
}

/** One place a plugin can be active: a scope type, such as `organization`, and its id. */
export interface PluginScope {
	type: string;
	id: string;
}

/** Whether a plugin is active, at its own scope. */
export interface PluginState {
	appId: string;
	scope: PluginScope;
	active: boolean;
}
