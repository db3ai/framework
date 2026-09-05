import { fileURLToPath } from 'node:url';
import type { App } from '@db3.ai/app';
import { resolveDatabaseDialect } from '@db3.ai/app/db';
import { DatabaseMigrationManager } from '@db3.ai/app/db/migrations';
import { models } from './models';

/** Creates the single migration manager shared by CLI commands and test bootstrap. */
export function migrations(application: App) {
	return new DatabaseMigrationManager({
		db: application.db.knex,
		dialect: resolveDatabaseDialect('mariadb'),
		models,
		migrationsDirectory: fileURLToPath(new URL('../../database/migrations', import.meta.url)),
		snapshotFile: fileURLToPath(new URL('../../database/schema.snapshot.json', import.meta.url)),
	});
}
