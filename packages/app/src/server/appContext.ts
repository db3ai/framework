import type { Knex } from 'knex';
import type { App } from './App';
import type { RequestContext } from './RequestContext';

export interface AppDatabaseProvider {
	db: {
		knex: Knex;
	};
	requestContext?: RequestContext;
}

let activeApp: AppDatabaseProvider | null = null;

/**
 * Registers the active app for framework services that need app-scoped access.
 */
export function setActiveApp(app: AppDatabaseProvider): AppDatabaseProvider {
	activeApp = app;
	return app;
}

/**
 * Returns the active application service hub.
 *
 * Framework and application jobs use this accessor to resolve services when
 * their handle methods run inside a bootstrapped worker process.
 *
 * @returns Active application instance.
 */
export function app<TApp extends AppDatabaseProvider = App>(): TApp {
	if (!activeApp) {
		throw new Error('No active application has been created.');
	}

	return activeApp as TApp;
}

/**
 * Clears the active app when the caller owns the current active instance.
 */
export function clearActiveApp(app?: AppDatabaseProvider): void {
	if (app && activeApp !== app) return;

	activeApp = null;
}

/**
 * Returns the active app database connection when an app is registered.
 */
export function activeAppDatabase(): Knex | null {
	return activeApp?.db.knex ?? null;
}

/**
 * Returns the active app request context when an app is registered.
 */
export function activeAppRequestContext(): RequestContext | null {
	return activeApp?.requestContext ?? null;
}
