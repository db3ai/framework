import { app } from '../../server';
import type { MakeMigrationOptions, MakeMigrationResult } from '../migrations/contracts';

/**
 * Generates reviewable migration source from the active app's model changes.
 * @param options - Optional name and explicitly requested source-generation policy.
 * @returns Generated source location or blocked changes; production restrictions remain enforced.
 */
export default async function makeMigration(options: MakeMigrationOptions = {}): Promise<MakeMigrationResult> {
	return app().db.migrations.makeMigration(options);
}
