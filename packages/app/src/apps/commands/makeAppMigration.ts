import { app } from '../../server';
import type { MakeMigrationOptions } from '../../db/migrations';

/** Generates a frozen app-owned migration and snapshot in development, without applying DDL. */
export async function makeAppMigration(id: string, name?: string, options: Pick<MakeMigrationOptions, 'retire' | 'dropRetired'> = {}) {
	await app().apps.load(id);
	const manager = app().apps.migrations(id);
	if (!manager) throw new Error(`App "${id}" has no database definition.`);
	return manager.makeMigration({ name, ...options });
}
