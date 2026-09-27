import type { Knex } from 'knex';
import type { ActiveRecordClass } from '../../ActiveRecord';
import type { DatabaseDialect } from '../../dialects';
import type { SchemaMigrationPlan } from './SchemaChange';

/**
 * Application-owned paths and runtime policy for database migration tooling.
 */
export interface DatabaseMigrationManagerOptions {
	/** Knex connection used for migration execution and database inspection. */
	db: Knex;

	/** Complete set of ActiveRecord models owned by the application. */
	models: readonly ActiveRecordClass[];

	/** Dialect used to collect field schema metadata. MariaDB is supported first. */
	dialect: DatabaseDialect;

	/** Absolute directory containing permanent Knex migration files. */
	migrationsDirectory: string;

	/** Absolute path of the committed desired-schema snapshot. */
	snapshotFile: string;

	/** Knex migration ledger table. Its lock table follows Knex naming. */
	migrationTableName?: string;

	/** Optional database schema containing the Knex migration ledger. */
	migrationSchemaName?: string;

	/** Migration file extensions Knex may load. */
	loadExtensions?: readonly string[];

	/** Generated migration format. Use .mjs for assets shared unchanged with npm packages. */
	migrationExtension?: '.ts' | '.mjs';

	/** Current application environment. Source generation is refused in production. */
	environment?: string;

	/** Absolute cross-process lock path used while generating source files. */
	generationLockFile?: string;

	/** Injectable clock used for deterministic migration filenames in tests. */
	now?: () => Date;
}

/**
 * Persisted and pending Knex migration names without mutating the ledger.
 */
export interface DatabaseMigrationState {
	completed: string[];
	pending: string[];
	missingFiles: string[];
}

/**
 * Combined model, snapshot, database, and Knex status for CLI or development UI.
 */
export interface DatabaseMigrationStatus {
	snapshotExists: boolean;
	modelsMatchSnapshot: boolean;
	databaseMatchesModels: boolean;
	generationPlan: SchemaMigrationPlan;
	databasePlan: SchemaMigrationPlan;
	migrations: DatabaseMigrationState;
}

/**
 * Result returned after checking the live database against current models.
 */
export interface DatabaseCheckResult {
	/** Whether the live model-owned schema satisfies current models. */
	schemaMatches: boolean;

	/** Whether current models have a corresponding committed snapshot. */
	modelsMatchSnapshot: boolean;

	/** Overall readiness including snapshot and Knex migration state. */
	matches: boolean;

	/** Differences between the live model-owned schema and current models. */
	plan: SchemaMigrationPlan;

	/** Differences between the committed snapshot and current models. */
	snapshotPlan: SchemaMigrationPlan;

	/** Completed, pending, and corrupt Knex migration history. */
	migrations: DatabaseMigrationState;
}

/**
 * Options accepted when generating one permanent migration file.
 */
export interface MakeMigrationOptions {
	/** Human-readable migration name. A deterministic name is inferred when omitted. */
	name?: string;

	/**
	 * When true, generate drop DDL for blocked column/index/foreign-key/table
	 * removals after warning. Other blocked operations still refuse generation.
	 */
	allowDestructive?: boolean;
}

/**
 * Result of comparing models with the committed snapshot and optionally writing
 * a new migration.
 */
export interface MakeMigrationResult {
	generated: boolean;
	blocked: boolean;
	file: string | null;
	plan: SchemaMigrationPlan;
}

/**
 * Options used when applying permanent Knex migrations.
 */
/**
 * Optional controls for applying committed migrations.
 */
export interface MigrateOptions {
	/**
	 * Adopt all pending migrations without DDL when an existing untracked
	 * database already matches the committed schema snapshot.
	 */
	baselineIfMatching?: boolean;
}

/**
 * Result of applying pending Knex migrations.
 */
export interface MigrateResult {
	applied: string[];
	batch: number | null;
	baselined: string[] | null;
}

/**
 * Result of the development `make -> migrate -> check` convenience operation.
 */
export interface DatabaseSyncResult {
	make: MakeMigrationResult;
	migrate: MigrateResult | null;
	check: DatabaseCheckResult | null;
}

/** Result of executing the latest migration's app-authored down function. */
export interface RollbackResult {
	reverted: string[];
	batch: number | null;
}
