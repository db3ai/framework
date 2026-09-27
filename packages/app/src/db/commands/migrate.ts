import { app } from '../../server';
import type { MigrateResult } from '../migrations/contracts';

/**
 * Applies the active app's committed pending migrations and returns their results.
 * @returns Applied and baselined filenames without terminal formatting.
 */
export default async function migrate(): Promise<MigrateResult> {
	return app().db.migrations.migrate();
}
