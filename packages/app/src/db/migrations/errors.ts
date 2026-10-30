import type { SchemaMigrationPlan } from './contracts';

/**
 * Error raised when another process already owns the source-generation lock.
 */
export class DatabaseMigrationLockError extends Error {
	/**
	 * Creates a generation-lock contention error.
	 *
	 * @param lockFile - Absolute lock file currently owned by another process.
	 */
	constructor(public readonly lockFile: string) {
		super(`Database migration generation is already running (${lockFile}).`);
		this.name = 'DatabaseMigrationLockError';
	}
}

/**
 * Error raised when an existing untracked database cannot safely adopt the
 * sole initial migration without executing its DDL.
 */
export class DatabaseMigrationBaselineError extends Error {
	/**
	 * Creates a baseline mismatch error with its structured schema differences.
	 *
	 * @param plan - Differences between the existing database and initial snapshot.
	 */
	constructor(public readonly plan: SchemaMigrationPlan) {
		super('Existing database does not match the initial schema snapshot.');
		this.name = 'DatabaseMigrationBaselineError';
	}
}

/**
 * Error raised when a source-writing operation is attempted in production.
 */
export class DatabaseMigrationSourceGenerationError extends Error {
	/**
	 * Creates a production source-generation policy error.
	 */
	constructor() {
		super('Database migration source generation is disabled in production.');
		this.name = 'DatabaseMigrationSourceGenerationError';
	}
}

/**
 * Error raised when a migration would drop retired schema in the same run that
 * retires it, while the release from before the retire may still be live.
 */
export class DatabaseMigrationOrderError extends Error {
	/**
	 * Creates an ordering error naming the drop and the retire migrations it waits for.
	 *
	 * @param file - Pending migration that drops retired schema.
	 * @param waiting - Retire migrations not applied in an earlier run.
	 */
	constructor(public readonly file: string, public readonly waiting: readonly string[]) {
		super(`${file} drops schema retired by ${waiting.join(', ')}; deploy the retiring release first.`);
		this.name = 'DatabaseMigrationOrderError';
	}
}
