import { app } from '../../server';
import type { MigrateResult } from '../migrations/contracts';

/**
 * Applies the active app's committed pending migrations, then saves its models' field settings
 * for db3 Cloud's Database view, and returns the migration results.
 * @returns Applied and baselined filenames without terminal formatting.
 */
export default async function migrate(): Promise<MigrateResult> {
	const migrations = app().db.migrations;
	const result = await migrations.migrate();
	await migrations.writeFieldSettings();
	return result;
}
