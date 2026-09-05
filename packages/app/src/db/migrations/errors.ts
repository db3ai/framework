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
