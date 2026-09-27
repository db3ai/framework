import { app } from '../../server';
import type { DatabaseCheckResult } from '../migrations/contracts';

/**
 * Checks the active app's database, models, snapshot and migration history.
 * @returns Consistency findings for CLI, application or authorized UI callers.
 */
export default async function check(): Promise<DatabaseCheckResult> {
	return app().db.migrations.check();
}
