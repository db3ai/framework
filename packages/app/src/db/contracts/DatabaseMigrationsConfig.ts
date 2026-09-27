import type { DatabaseMigrationManagerOptions } from '../migrations/contracts';

/**
 * App-owned model registry and migration policy.
 *
 * The database service supplies its connection and dialect. Committed migrations
 * always live in server/database/migrations and the snapshot in
 * server/database/schema.snapshot.json, relative to the application directory.
 */
export type DatabaseMigrationsConfig = Omit<DatabaseMigrationManagerOptions, 'db' | 'dialect' | 'migrationsDirectory' | 'snapshotFile'>;
