/**
 * Makes an app a plugin: something each scope, such as an organization or a hosted app, turns
 * on and off. The switch only stores on or off and announces it; it knows nothing of billing.
 */
export interface AppPlugin {
	/**
	 * What one switch covers, named like the route parameter that carries it: `organization`
	 * covers `:organization`. Every route of the plugin must have that parameter.
	 */
	scope: string;
	/** `on`: on until someone turns it off. `off` (the default): off until someone turns it on. */
	default?: 'on' | 'off';
}

/** One place a plugin can be on: a scope type, such as `organization`, and its id. */
export interface PluginScope {
	type: string;
	id: string;
}

/** Whether a plugin is on, at its own scope. */
export interface PluginState {
	appId: string;
	scope: PluginScope;
	on: boolean;
}
