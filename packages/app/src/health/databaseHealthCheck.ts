import type { Database } from '../db';
import type { HealthCheck } from './contracts';

/**
 * Creates the standard database dependency check used by HTTP applications.
 *
 * The query proves the active connection can accept work without inspecting
 * application tables or mutating customer data.
 *
 * @param database - Framework database service to query.
 * @returns Health check suitable for `app().health.register()`.
 *
 * @example
 * app().health.register('database', databaseHealthCheck(app().db));
 */
export function databaseHealthCheck(database: Database): HealthCheck {
	return async () => {
		await database.knex.raw('SELECT 1');
		return { status: 'ok' };
	};
}
