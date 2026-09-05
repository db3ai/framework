import {
	access,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from 'node:fs/promises';
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
} from 'node:path';
import type { Knex } from 'knex';
import type {
	DatabaseCheckResult,
	DatabaseMigrationManagerOptions,
	DatabaseMigrationState,
	DatabaseMigrationStatus,
	DatabaseSyncResult,
	MakeMigrationOptions,
	MakeMigrationResult,
	MigrateOptions,
	MigrateResult,
	SchemaMigrationPlan,
	SchemaSnapshot,
} from './contracts';
import { inspectDatabaseSchema } from './DatabaseSchemaInspector';
import {
	DatabaseMigrationBaselineError,
	DatabaseMigrationLockError,
	DatabaseMigrationSourceGenerationError,
} from './errors';
import { renderKnexMigration } from './KnexMigrationRenderer';
import { collectModelSchema } from './ModelSchemaCollector';
import { diffSchemaSnapshots } from './SchemaDiffer';
import { promoteDestructiveSchemaChanges } from './promoteDestructiveSchemaChanges';
import {
	emptySchemaSnapshot,
	parseSchemaSnapshot,
	serializeSchemaSnapshot,
} from './SchemaSnapshotSerializer';

const DEFAULT_MIGRATION_TABLE = 'knex_migrations';
const DEFAULT_LOAD_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'] as const;

/**
 * Reusable application-configured model migration service.
 *
 * CLI commands, development HTTP actions, and deployment scripts should call
 * this service rather than duplicating model collection or Knex execution.
 */
export class DatabaseMigrationManager {
	readonly #options: Required<Pick<
		DatabaseMigrationManagerOptions,
		'migrationTableName' | 'loadExtensions' | 'environment' | 'generationLockFile' | 'now'
	>> & DatabaseMigrationManagerOptions;

	/**
	 * Creates a migration manager with app-owned models, paths, and ledger name.
	 *
	 * @param options - Database connection, model registry, and absolute source paths.
	 */
	constructor(options: DatabaseMigrationManagerOptions) {
		assertAbsolutePath(options.migrationsDirectory, 'migrationsDirectory');
		assertAbsolutePath(options.snapshotFile, 'snapshotFile');

		const generationLockFile = options.generationLockFile
			?? `${options.snapshotFile}.lock`;

		assertAbsolutePath(generationLockFile, 'generationLockFile');

		if (options.dialect.name !== 'mariadb') {
			throw new Error('Generated database migrations currently support MariaDB only.');
		}

		this.#options = {
			...options,
			models: [...options.models],
			migrationTableName: options.migrationTableName ?? DEFAULT_MIGRATION_TABLE,
			loadExtensions: options.loadExtensions ?? DEFAULT_LOAD_EXTENSIONS,
			environment: options.environment ?? process.env.NODE_ENV ?? 'development',
			generationLockFile,
			now: options.now ?? (() => new Date()),
		};
	}

	/**
	 * Returns model, snapshot, live database, and Knex migration status without
	 * creating the Knex migration ledger.
	 *
	 * @returns Structured status suitable for CLI or development UI rendering.
	 */
	async status(): Promise<DatabaseMigrationStatus> {
		const desired = this.#collectModels();
		const snapshot = await this.#readSnapshot();
		const generationPlan = diffSchemaSnapshots(
			snapshot ?? emptySchemaSnapshot(this.#options.dialect.name),
			desired,
		);
		const database = await inspectDatabaseSchema(
			this.#options.db,
			desired,
			this.#options.dialect,
		);
		const databasePlan = diffSchemaSnapshots(database, desired);

		return {
			snapshotExists: snapshot !== null,
			modelsMatchSnapshot: !planHasChanges(generationPlan),
			databaseMatchesModels: !planHasChanges(databasePlan),
			generationPlan,
			databasePlan,
			migrations: await this.#readMigrationState(),
		};
	}

	/**
	 * Checks the live model-owned database subset against current models.
	 *
	 * Extra columns and tables are ignored to preserve additive blue/green
	 * compatibility, while missing or incompatible requirements are reported.
	 *
	 * @returns Structured database compatibility result.
	 */
	async check(): Promise<DatabaseCheckResult> {
		const desired = this.#collectModels();
		const snapshot = await this.#readSnapshot();
		const database = await inspectDatabaseSchema(
			this.#options.db,
			desired,
			this.#options.dialect,
		);
		const plan = diffSchemaSnapshots(database, desired);
		const snapshotPlan = diffSchemaSnapshots(
			snapshot ?? emptySchemaSnapshot(this.#options.dialect.name),
			desired,
		);
		const migrations = await this.#readMigrationState();
		const schemaMatches = !planHasChanges(plan);
		const modelsMatchSnapshot = snapshot !== null
			&& !planHasChanges(snapshotPlan);

		return {
			schemaMatches,
			modelsMatchSnapshot,
			matches: schemaMatches
				&& modelsMatchSnapshot
				&& migrations.pending.length === 0
				&& migrations.missingFiles.length === 0,
			plan,
			snapshotPlan,
			migrations,
		};
	}

	/**
	 * Generates a frozen migration and advances the committed snapshot when
	 * current models contain only supported changes.
	 *
	 * @param options - Optional human-readable migration name.
	 * @returns Generation result including blocked changes or written file path.
	 */
	async makeMigration(
		options: MakeMigrationOptions = {},
	): Promise<MakeMigrationResult> {
		this.#assertSourceGenerationAllowed();

		return await this.#withGenerationLock(async () => {
			return await this.#makeMigrationUnlocked(options);
		});
	}

	/**
	 * Applies pending committed migrations through Knex's ledger and lock.
	 *
	 * @param options - Optional matching-database baseline policy.
	 * @returns Applied migration names, batch, and optional baselined filenames.
	 */
	async migrate(options: MigrateOptions = {}): Promise<MigrateResult> {
		const baselined = options.baselineIfMatching
			? await this.#baselinePendingMigrationsIfMatching()
			: null;
		const result = await this.#options.db.migrate.latest(this.#knexConfig());
		const batch = Array.isArray(result) && typeof result[0] === 'number'
			? result[0]
			: null;
		const applied = Array.isArray(result) && Array.isArray(result[1])
			? result[1].map(String)
			: [];

		return {
			applied,
			batch,
			baselined,
		};
	}

	/**
	 * Runs the development convenience flow under one generation lock.
	 *
	 * A blocked model diff returns immediately without applying migrations. A
	 * successful flow always finishes with a live database compatibility check.
	 *
	 * @param options - Optional human-readable generated migration name.
	 * @returns Structured make, migrate, and check results.
	 */
	async sync(options: MakeMigrationOptions = {}): Promise<DatabaseSyncResult> {
		this.#assertSourceGenerationAllowed();

		return await this.#withGenerationLock(async () => {
			const make = await this.#makeMigrationUnlocked(options);

			if (make.blocked) {
				return {
					make,
					migrate: null,
					check: null,
				};
			}

			const migrate = await this.migrate({ baselineIfMatching: true });
			const check = await this.check();

			return { make, migrate, check };
		});
	}

	/**
	 * Performs source generation while the caller owns the cross-process lock.
	 *
	 * @param options - Optional human-readable migration name.
	 * @returns Generation result including blocked changes or written file path.
	 */
	async #makeMigrationUnlocked(
		options: MakeMigrationOptions,
	): Promise<MakeMigrationResult> {
		const desired = this.#collectModels();
		const snapshot = await this.#readSnapshot();
		const previous = snapshot ?? emptySchemaSnapshot(this.#options.dialect.name);
		const rawPlan = diffSchemaSnapshots(previous, desired);
		const plan = options.allowDestructive
			? promoteDestructiveSchemaChanges(rawPlan)
			: rawPlan;

		if (plan.blockedChanges.length > 0) {
			return {
				generated: false,
				blocked: true,
				file: null,
				plan: rawPlan,
			};
		}

		if (plan.safeChanges.length === 0) {
			if (!snapshot) {
				await writeSnapshotAtomically(this.#options.snapshotFile, desired);
			}

			return {
				generated: false,
				blocked: false,
				file: null,
				plan,
			};
		}

		const name = migrationName(options.name, plan);
		const file = join(
			this.#options.migrationsDirectory,
			`${formatMigrationTimestamp(this.#options.now())}_${name}.ts`,
		);
		const source = renderKnexMigration(plan);

		await writeMigrationAndSnapshotAtomically(
			file,
			source,
			this.#options.snapshotFile,
			desired,
		);

		return {
			generated: true,
			blocked: false,
			file,
			plan,
		};
	}

	/**
	 * Collects the current app model registry as a normalized snapshot.
	 *
	 * @returns Current desired database state.
	 */
	#collectModels(): SchemaSnapshot {
		return collectModelSchema(this.#options.models, this.#options.dialect);
	}

	/**
	 * Reads the committed desired snapshot when one exists.
	 *
	 * @returns Parsed snapshot or null before the first generation.
	 */
	async #readSnapshot(): Promise<SchemaSnapshot | null> {
		try {
			return parseSchemaSnapshot(
				await readFile(this.#options.snapshotFile, 'utf8'),
			);
		} catch (error) {
			if (isNodeError(error, 'ENOENT')) return null;

			throw error;
		}
	}

	/**
	 * Reads migration files and any existing Knex ledger without causing Knex to
	 * create its ledger tables as a side effect.
	 *
	 * @returns Completed, pending, and corrupt missing-file migration names.
	 */
	async #readMigrationState(): Promise<DatabaseMigrationState> {
		const files = await this.#readMigrationFiles();
		const completed = await this.#readCompletedMigrations();
		const fileSet = new Set(files);
		const completedSet = new Set(completed);

		return {
			completed,
			pending: files.filter(file => !completedSet.has(file)),
			missingFiles: completed.filter(file => !fileSet.has(file)),
		};
	}

	/**
	 * Adopts pending migrations when an existing untracked database exactly
	 * satisfies the committed schema snapshot.
	 *
	 * Empty databases execute migration DDL normally. A partial or mismatching
	 * database raises a structured baseline error instead of guessing. Once a
	 * second permanent migration exists, local databases that never recorded the
	 * initial ledger entry still need this path — matching against the snapshot
	 * end-state baselines every pending file without replaying create-table DDL.
	 *
	 * @returns Baselined filenames, or null when normal migration should proceed.
	 */
	async #baselinePendingMigrationsIfMatching(): Promise<string[] | null> {
		const state = await this.#readMigrationState();

		if (
			state.completed.length > 0
			|| state.pending.length === 0
			|| state.missingFiles.length > 0
		) {
			return null;
		}

		const snapshot = await this.#readSnapshot();

		if (!snapshot) {
			throw new Error('Cannot baseline a database without a committed schema snapshot.');
		}

		const database = await inspectDatabaseSchema(
			this.#options.db,
			snapshot,
			this.#options.dialect,
		);

		if (database.tables.length === 0) {
			return null;
		}

		const plan = diffSchemaSnapshots(database, snapshot);

		if (planHasChanges(plan)) {
			throw new DatabaseMigrationBaselineError(plan);
		}

		const {
			directory: _directory,
			loadExtensions: _loadExtensions,
			...baselineConfig
		} = this.#knexConfig();

		await this.#options.db.migrate.latest({
			...baselineConfig,
			migrationSource: new NoopMigrationSource(state.pending),
		});

		return [...state.pending];
	}

	/**
	 * Returns permanent migration filenames accepted by configured extensions.
	 *
	 * @returns Lexically sorted migration basenames.
	 */
	async #readMigrationFiles(): Promise<string[]> {
		try {
			const entries = await readdir(this.#options.migrationsDirectory, {
				withFileTypes: true,
			});
			const extensions = new Set(this.#options.loadExtensions);

			return entries
				.filter(entry => entry.isFile() && extensions.has(extname(entry.name)))
				.map(entry => entry.name)
				.sort();
		} catch (error) {
			if (isNodeError(error, 'ENOENT')) return [];

			throw error;
		}
	}

	/**
	 * Reads completed migration names when the app's Knex ledger already exists.
	 *
	 * @returns Ordered completed migration names.
	 */
	async #readCompletedMigrations(): Promise<string[]> {
		const schema = this.#options.migrationSchemaName
			? this.#options.db.schema.withSchema(this.#options.migrationSchemaName)
			: this.#options.db.schema;
		const exists = await schema.hasTable(this.#options.migrationTableName);

		if (!exists) return [];

		const query = this.#options.migrationSchemaName
			? this.#options.db
				.withSchema(this.#options.migrationSchemaName)
				.from<{ name: unknown }>(this.#options.migrationTableName)
			: this.#options.db<{ name: unknown }>(this.#options.migrationTableName);
		const rows = await query.select('name').orderBy('id');

		return rows.map(row => String(row.name));
	}

	/**
	 * Returns the shared Knex migration configuration used by every execution.
	 *
	 * @returns Knex directory, ledger, extension, and MariaDB transaction policy.
	 */
	#knexConfig(): Knex.MigratorConfig {
		return {
			directory: this.#options.migrationsDirectory,
			tableName: this.#options.migrationTableName,
			schemaName: this.#options.migrationSchemaName,
			loadExtensions: this.#options.loadExtensions,
			disableTransactions: true,
		};
	}

	/**
	 * Rejects all source-writing entry points in a production environment.
	 */
	#assertSourceGenerationAllowed(): void {
		if (this.#options.environment.trim().toLowerCase() === 'production') {
			throw new DatabaseMigrationSourceGenerationError();
		}
	}

	/**
	 * Acquires and releases the app's cross-process source-generation lock.
	 *
	 * @param callback - Generation work that must have exclusive filesystem access.
	 * @returns Callback result.
	 */
	async #withGenerationLock<TResult>(
		callback: () => Promise<TResult>,
	): Promise<TResult> {
		await mkdir(dirname(this.#options.generationLockFile), { recursive: true });

		let handle;

		try {
			handle = await open(this.#options.generationLockFile, 'wx');
			await handle.writeFile(JSON.stringify({
				pid: process.pid,
				createdAt: new Date().toISOString(),
			}));
		} catch (error) {
			if (handle) {
				await handle.close().catch(() => undefined);
				await unlink(this.#options.generationLockFile).catch(() => undefined);
			}

			if (isNodeError(error, 'EEXIST')) {
				throw new DatabaseMigrationLockError(this.#options.generationLockFile);
			}

			throw error;
		}

		try {
			return await callback();
		} finally {
			await handle.close();
			await unlink(this.#options.generationLockFile).catch(error => {
				if (!isNodeError(error, 'ENOENT')) throw error;
			});
		}
	}
}

/**
 * Knex migration source that records matching migrations while intentionally
 * performing no schema DDL.
 */
class NoopMigrationSource implements Knex.MigrationSource<string> {
	readonly #migrationNames: readonly string[];

	/**
	 * Creates a baseline migration source for one or more pending filenames.
	 *
	 * @param migrationNames - Permanent migration filenames to record as complete.
	 */
	constructor(migrationNames: readonly string[]) {
		this.#migrationNames = [...migrationNames];
	}

	/**
	 * Returns the pending migration names being baselined.
	 *
	 * @returns Migration collection.
	 */
	async getMigrations(): Promise<string[]> {
		return [...this.#migrationNames];
	}

	/**
	 * Returns the stable Knex ledger name for one source entry.
	 *
	 * @param migration - Source entry.
	 * @returns Knex ledger filename.
	 */
	getMigrationName(migration: string): string {
		return migration;
	}

	/**
	 * Returns a no-op migration used only after an exact live schema match.
	 *
	 * @returns Knex-compatible migration implementation.
	 */
	async getMigration(): Promise<Knex.Migration> {
		return {
			/**
			 * Records the baseline without repeating already-installed DDL.
			 *
			 * @returns Already-resolved promise.
			 */
			async up(): Promise<void> {},

			/**
			 * Refuses rollback of an adopted database baseline.
			 *
			 * @returns Promise that always rejects without changing the database.
			 */
			async down(): Promise<void> {
				throw new Error('Database baselines are forward-only.');
			},
		};
	}
}

/**
 * Reports whether a schema plan contains any safe or blocked difference.
 *
 * @param plan - Pure schema comparison result.
 * @returns True when snapshots do not match.
 */
function planHasChanges(plan: SchemaMigrationPlan): boolean {
	return plan.safeChanges.length > 0 || plan.blockedChanges.length > 0;
}

/**
 * Writes one generated migration and its new snapshot as a coordinated pair.
 *
 * Temporary files are fully written before either destination is renamed. If
 * advancing the snapshot fails after the migration rename, the new migration
 * is removed so the committed lineage cannot be left half-advanced.
 *
 * @param migrationFile - Final absolute migration filename.
 * @param source - Frozen TypeScript migration source.
 * @param snapshotFile - Final absolute snapshot filename.
 * @param snapshot - New desired schema snapshot.
 */
async function writeMigrationAndSnapshotAtomically(
	migrationFile: string,
	source: string,
	snapshotFile: string,
	snapshot: SchemaSnapshot,
): Promise<void> {
	await mkdir(dirname(migrationFile), { recursive: true });
	await mkdir(dirname(snapshotFile), { recursive: true });

	const migrationTemporary = temporaryFileName(migrationFile);
	const snapshotTemporary = temporaryFileName(snapshotFile);
	let migrationMoved = false;

	try {
		await access(migrationFile).then(
			() => {
				throw new Error(`Migration file already exists: ${migrationFile}`);
			},
			() => undefined,
		);
		await Promise.all([
			writeFile(migrationTemporary, source, { encoding: 'utf8', flag: 'wx' }),
			writeFile(snapshotTemporary, serializeSchemaSnapshot(snapshot), {
				encoding: 'utf8',
				flag: 'wx',
			}),
		]);
		await rename(migrationTemporary, migrationFile);
		migrationMoved = true;
		await rename(snapshotTemporary, snapshotFile);
	} catch (error) {
		if (migrationMoved) {
			await unlink(migrationFile).catch(() => undefined);
		}

		throw error;
	} finally {
		await Promise.all([
			unlink(migrationTemporary).catch(() => undefined),
			unlink(snapshotTemporary).catch(() => undefined),
		]);
	}
}

/**
 * Writes a snapshot through a same-directory temporary file and atomic rename.
 *
 * @param snapshotFile - Final absolute snapshot filename.
 * @param snapshot - New desired schema snapshot.
 */
async function writeSnapshotAtomically(
	snapshotFile: string,
	snapshot: SchemaSnapshot,
): Promise<void> {
	await mkdir(dirname(snapshotFile), { recursive: true });

	const temporary = temporaryFileName(snapshotFile);

	try {
		await writeFile(temporary, serializeSchemaSnapshot(snapshot), {
			encoding: 'utf8',
			flag: 'wx',
		});
		await rename(temporary, snapshotFile);
	} finally {
		await unlink(temporary).catch(() => undefined);
	}
}

/**
 * Creates a process-specific same-directory temporary filename.
 *
 * @param file - Final destination path.
 * @returns Temporary filename safe for atomic rename.
 */
function temporaryFileName(file: string): string {
	return join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
}

/**
 * Produces a sortable UTC timestamp used by Knex migration filenames.
 *
 * @param date - Generation time.
 * @returns Compact YYYYMMDDHHmmss timestamp.
 */
function formatMigrationTimestamp(date: Date): string {
	if (!Number.isFinite(date.getTime())) {
		throw new Error('Migration generation clock returned an invalid date.');
	}

	return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/**
 * Resolves a supplied or inferred migration name to a safe filename slug.
 *
 * @param requested - Optional caller-provided migration name.
 * @param plan - Schema plan used for deterministic name inference.
 * @returns Lower-case underscore-separated filename segment.
 */
function migrationName(
	requested: string | undefined,
	plan: SchemaMigrationPlan,
): string {
	const inferred = requested?.trim() || inferMigrationName(plan);
	const slug = inferred
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

	if (!slug) {
		throw new Error('Migration name must contain at least one letter or number.');
	}

	return slug;
}

/**
 * Infers a concise filename from a simple migration plan.
 *
 * @param plan - Safe non-empty migration plan.
 * @returns Human-readable migration name.
 */
function inferMigrationName(plan: SchemaMigrationPlan): string {
	if (plan.safeChanges.length === 1) {
		const change = plan.safeChanges[0];

		if (change?.kind === 'create_table') {
			return `create_${change.table.name}`;
		}

		if (change?.kind === 'add_column') {
			return `add_${change.column.name}_to_${change.tableName}`;
		}
	}

	return 'update_database_schema';
}

/**
 * Validates that app-owned source locations do not depend on process cwd.
 *
 * @param value - Configured path.
 * @param option - Configuration field included in validation errors.
 */
function assertAbsolutePath(value: string, option: string): void {
	if (!isAbsolute(value)) {
		throw new Error(`${option} must be an absolute path.`);
	}
}

/**
 * Narrows a Node filesystem error to a specific code.
 *
 * @param error - Unknown caught error.
 * @param code - Expected Node error code.
 * @returns True when the error exposes the requested code.
 */
function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error
		&& 'code' in error
		&& (error as NodeJS.ErrnoException).code === code;
}
