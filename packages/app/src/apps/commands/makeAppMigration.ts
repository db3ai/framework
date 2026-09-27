import { app } from '../../server';

/** Generates a frozen app-owned migration and snapshot in development, without applying DDL. */
export async function makeAppMigration(id: string, name?: string) {
	await app().apps.load(id);
	const manager = app().apps.migrations(id);
	if (!manager) throw new Error(`App "${id}" has no database definition.`);
	return manager.makeMigration({ name });
}
