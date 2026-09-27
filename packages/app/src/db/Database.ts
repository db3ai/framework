import type { Knex } from 'knex';
import { resolve } from 'node:path';
import { normalizeDatabaseComment } from '@db3.ai/pure';

import type {
	ActiveRecord,
	ActiveRecordClass,
} from './ActiveRecord';
import { ActiveRecord as ActiveRecordBase } from './ActiveRecord';
import type * as database from './contracts';
import { DatabaseMigrationManager } from './migrations/DatabaseMigrationManager';
import {
	databaseDialectForConnection,
	type DatabaseDialect,
	type TableIndexSpec,
} from './dialects';
import type {
	DbColumnSpec,
	DbForeignKeySpec,
	DbIndexColumnSpec,
	DbIndexSpec,
	DbSchemaPart,
} from './FieldType';
import { writeDbColumn } from './FieldType';
import {
	enableDefaultQueryMonitor,
	type QueryMonitor,
	type QueryMonitorOptions,
} from './queryMonitor';

/** App-owned model registry and policies for migrations, query monitoring and schema synchronization. */
export interface DatabaseOptions {
	/** Model registry and policy for migrations under the app's server/database directory. */
	migrations?: database.DatabaseMigrationsConfig;
	/**
	 * Configures query telemetry for this database connection.
	 */
	queryMonitor?: false | QueryMonitorOptions;

	/**
	 * Whether `install()` should add missing model columns and relax existing
	 * columns that are now nullable or safely wider.
	 */
	syncColumns?: boolean;

	/**
	 * Whether `install()` should add missing model indexes to existing tables.
	 */
	syncIndexes?: boolean;

	/**
	 * Reports schema differences left after `install()` runs safe sync steps.
	 * Defaults to `warn`; set false to silence or pass a custom reporter.
	 */
	reportSchemaDiff?: DatabaseSchemaDiffReporter;
}

export interface DatabaseInstallOptions {
	/**
	 * Per-install override for adding missing model columns to existing tables.
	 */
	syncColumns?: boolean;

	/**
	 * Per-install override for adding missing model indexes to existing tables.
	 */
	syncIndexes?: boolean;

	/**
	 * Per-install override for reporting remaining schema differences.
	 */
	reportSchemaDiff?: DatabaseSchemaDiffReporter;
}

export type DatabaseSchemaDifferenceKind =
	| 'missing_table'
	| 'missing_column'
	| 'missing_index'
	| 'type_mismatch'
	| 'nullable_mismatch';

export type DatabaseSchemaDiffReporter =
	| false
	| 'warn'
	| ((
		diffs: DatabaseSchemaDiff[],
		database: Database,
	) => void | Promise<void>);

export interface DatabaseSchemaDifference {
	kind: DatabaseSchemaDifferenceKind;
	table: string;
	column?: string;
	index?: string;
	columns?: string[];
	databaseValue?: unknown;
	modelValue?: unknown;
	rowsWithNull?: number;
	blocked?: boolean;
	message: string;
}

export interface DatabaseSchemaDiff {
	model: string;
	table: string;
	differences: DatabaseSchemaDifference[];
}

type InstallArgs =
	| ActiveRecordClass[]
	| [DatabaseInstallOptions, ...ActiveRecordClass[]];

interface InstallColumnOptions {
	alter?: boolean;
	alterNullable?: boolean;
	alterType?: boolean;
	applyDefault?: boolean;
	applyComment?: boolean;
}

interface NormalizedIndexColumn {
	name: string;
	order?: 'asc' | 'desc';
}

interface MissingIndex {
	index: DbIndexSpec;
	blocked: boolean;
	message: string;
}

interface InstalledTableSchema {
	columnInfo: Record<string, unknown>;
	indexes: TableIndexSpec[];
}

/**
 * App-facing database service.
 *
 * This gathers database operations that do not really belong on an individual
 * record instance, while keeping the existing ActiveRecord model definitions.
 */
export class Database {
	private readonly monitor: QueryMonitor | null;
	#backupHandler?: database.DatabaseBackupHandler;
	#migrations?: DatabaseMigrationManager;
	readonly #directory: string;

	/**
	 * Returns migrations from the application's conventional server/database paths.
	 * @returns Lazy migration manager shared by commands, tests and application operations.
	 * @throws When the app has not supplied dbOptions.migrations.
	 */
	get migrations(): DatabaseMigrationManager {
		if (!this.options.migrations) throw new Error('Configure dbOptions.migrations with { models } for the app model registry.');
		return this.#migrations ??= new DatabaseMigrationManager({
			...this.options.migrations,
			db: this.connection,
			dialect: this.dialect(),
			migrationsDirectory: resolve(this.#directory, 'server/database/migrations'),
			snapshotFile: resolve(this.#directory, 'server/database/schema.snapshot.json'),
		});
	}

	/**
	 * Creates a database service and captures its application directory once.
	 * @param connection - Connection owned by the application or its caller.
	 * @param options - Model registry, migration policy and schema/query settings.
	 * @param directory - App root supplied by App; standalone services default to the current directory.
	 */
	constructor(
		private readonly connection: Knex,
		private readonly options: DatabaseOptions = {},
		directory: string = process.cwd(),
	) {
		this.#directory = resolve(directory);
		this.monitor = enableDefaultQueryMonitor(
			this.connection,
			this.options.queryMonitor,
		);
	}

	/**
	 * Collects database schema metadata from every field on a model.
	 */
	static getSchema<TRecord extends ActiveRecord>(
		Model: ActiveRecordClass<TRecord>,
		dialect?: DatabaseDialect,
	): Required<DbSchemaPart> {
		const columns = new Map<string, DbColumnSpec>();
		const indexes: DbIndexSpec[] = [];
		const foreignKeys: DbForeignKeySpec[] = [];

		for (const [fieldName, field] of Object.entries(Model.getFields())) {
			const schema = field.getDbSchema({
				model: Model,
				fieldName,
				dialect,
			});
			const fieldComment = normalizeDatabaseComment(field.config.comment);

			for (const column of schema.columns ?? []) {
				const columnWithComment = fieldComment && !column.comment
					? {
						...column,
						comment: fieldComment,
					}
					: column;

				if (columns.has(columnWithComment.name)) {
					throw new Error(
						`Duplicate column "${columnWithComment.name}" on model ${Model.name}`,
					);
				}

				columns.set(columnWithComment.name, columnWithComment);
			}

			indexes.push(...(schema.indexes ?? []));
			foreignKeys.push(...(schema.foreignKeys ?? []));
		}

		return {
			columns: [...columns.values()],
			indexes,
			foreignKeys,
		};
	}

	/**
	 * Returns the raw Knex connection for low-level database work.
	 */
	get knex(): Knex {
		return this.connection;
	}

	/**
	 * Returns the query monitor attached to this connection, when enabled.
	 */
	get queryMonitor(): QueryMonitor | null {
		return this.monitor;
	}

	/**
	 * Configures the application-owned implementation used by `backup()`.
	 *
	 * @param handler - Function that creates and persists one database backup.
	 * @returns This database service for fluent application wiring.
	 */
	setBackupHandler(handler: database.DatabaseBackupHandler): this {
		this.#backupHandler = handler;

		return this;
	}

	/**
	 * Creates a database backup through the active application's backup policy.
	 *
	 * @param request - Durable, JSON-safe metadata identifying the backup request.
	 * @returns Application-defined backup result, such as a completed manifest.
	 *
	 * @example
	 * const manifest = await app().db.backup<DatabaseBackupManifest>({
	 * 	backupId,
	 * 	createdAt,
	 * 	trigger: 'manual',
	 * });
	 */
	async backup<TResult = unknown>(request: Record<string, unknown>): Promise<TResult> {
		if (!this.#backupHandler) {
			throw new Error('Database backup has not been configured for this application.');
		}

		return await this.#backupHandler(request) as TResult;
	}

	/**
	 * Starts a raw Knex query against a table.
	 */
	table<TRecord extends {} = any, TResult = TRecord[]>(
		tableName: string,
	): Knex.QueryBuilder<TRecord, TResult> {
		return this.connection<TRecord, TResult>(tableName);
	}

	/**
	 * Creates database tables for one or more ActiveRecord models.
	 */
	async install(...models: ActiveRecordClass[]): Promise<void>;
	async install(
		options: DatabaseInstallOptions,
		...models: ActiveRecordClass[]
	): Promise<void>;
	async install(...input: InstallArgs): Promise<void> {
		const {
			models,
			options,
		} = resolveInstallArgs(input);
		const tableComments = await this.tableCommentsFor(models);
		const modelsWithPotentialDiffs: ActiveRecordClass[] = [];

		for (const Model of models) {
			const hasPotentialDiff = await this.installModel(
				Model,
				options,
				tableComments.get(Model.table),
			);

			if (hasPotentialDiff) {
				modelsWithPotentialDiffs.push(Model);
			}
		}

		await this.reportDiffAfterInstall(modelsWithPotentialDiffs, options);
	}

	/**
	 * Compares model schema metadata with the live database without changing it.
	 *
	 * This intentionally reports a small, high-signal subset instead of trying to
	 * be a migration planner.
	 */
	async diff(...models: ActiveRecordClass[]): Promise<DatabaseSchemaDiff[]> {
		const diffs: DatabaseSchemaDiff[] = [];

		for (const Model of models) {
			const schema = this.getSchema(Model);
			const differences: DatabaseSchemaDifference[] = [];
			const tableExists = await this.connection.schema.hasTable(Model.table);

			if (!tableExists) {
				differences.push({
					kind: 'missing_table',
					table: Model.table,
					modelValue: Model.table,
					message: `Table ${Model.table} is missing.`,
				});
			} else {
				const columnInfo = await this.connection(Model.table).columnInfo();
				const existingColumnNames = new Set(Object.keys(columnInfo));
				const tableIndexes = await this.getTableIndexes(Model.table);

				for (const column of schema.columns) {
					const info = columnInfo[column.name];

					if (!info) {
						differences.push({
							kind: 'missing_column',
							table: Model.table,
							column: column.name,
							modelValue: describeColumn(column),
							message: `Column ${Model.table}.${column.name} is missing; model expects ${describeColumn(column)}.`,
						});
						continue;
					}

					const databaseNullable = columnAllowsNull(info);
					const modelNullable = modelColumnAllowsNull(column);

					if (
						databaseNullable !== null
						&& databaseNullable !== modelNullable
					) {
						const rowsWithNull = databaseNullable && !modelNullable
							? await this.countRowsWithNull(Model.table, column.name)
							: undefined;

						differences.push({
							kind: 'nullable_mismatch',
							table: Model.table,
							column: column.name,
							databaseValue: databaseNullable,
							modelValue: modelNullable,
							rowsWithNull,
							blocked: Boolean(rowsWithNull),
							message: nullableMismatchMessage(
								Model.table,
								column.name,
								databaseNullable,
								modelNullable,
								rowsWithNull,
							),
						});
					}

					const typeDifference = columnTypeDifference(
						Model.table,
						column,
						info,
						tableIndexes,
					);

					if (typeDifference) {
						differences.push(typeDifference);
					}
				}

				const missingIndexes = findMissingIndexes(
					schema.indexes,
					tableIndexes,
					existingColumnNames,
				);

				for (const missingIndex of missingIndexes) {
					differences.push({
						kind: 'missing_index',
						table: Model.table,
						index: missingIndex.index.name,
						columns: missingIndex.index.columns.map(indexColumnName),
						modelValue: describeIndex(missingIndex.index),
						blocked: missingIndex.blocked,
						message: missingIndex.message,
					});
				}
			}

			if (differences.length > 0) {
				diffs.push({
					model: Model.name,
					table: Model.table,
					differences,
				});
			}
		}

		return diffs;
	}

	/**
	 * Renders schema diffs for logs or CLI output.
	 */
	formatDiff(diffs: DatabaseSchemaDiff[]): string {
		if (diffs.length === 0) {
			return 'Database schema matches model schema.';
		}

		return diffs
			.flatMap(diff => {
				return [
					`${diff.table} (${diff.model})`,
					...diff.differences.map(difference => {
						return `  - ${difference.message}`;
					}),
				];
			})
			.join('\n');
	}

	/**
	 * Collects database schema metadata from every field on a model.
	 */
	getSchema<TRecord extends ActiveRecord>(
		Model: ActiveRecordClass<TRecord>,
	): Required<DbSchemaPart> {
		return Database.getSchema(Model, this.dialect());
	}

	/**
	 * Runs work inside a transaction and exposes the transaction as a Database.
	 */
	async transaction<TResult>(
		callback: (db: Database) => Promise<TResult>,
	): Promise<TResult> {
		return this.connection.transaction(async transaction => {
			const transactionConnection = transaction as unknown as Knex;

			return ActiveRecordBase.withDb(transactionConnection, () => {
				return callback(new Database(transactionConnection, this.options, this.#directory));
			});
		});
	}

	/**
	 * Installs or safely synchronizes one ActiveRecord model.
	 *
	 * Existing column and index metadata is loaded once and shared by every
	 * synchronization step. The return value records whether the initial schema
	 * may have contained a reportable difference that should be checked after
	 * synchronization.
	 *
	 * @param Model - ActiveRecord model whose schema should be installed.
	 * @param options - Per-install synchronization options.
	 * @param currentTableComment - Existing database comment for this table.
	 * @returns Whether a post-install diff may still be useful.
	 */
	private async installModel<TRecord extends ActiveRecord>(
		Model: ActiveRecordClass<TRecord>,
		options: DatabaseInstallOptions,
		currentTableComment: string | null | undefined,
	): Promise<boolean> {
		const exists = await this.connection.schema.hasTable(Model.table);
		const schema = this.getSchema(Model);
		const tableComment = normalizeDatabaseComment(Model.comment);

		if (exists) {
			const installedSchema = await this.installedTableSchema(Model.table);
			const hasPotentialDiff = this.tableHasPotentialDiff(
				Model.table,
				schema,
				installedSchema,
			);

			await this.syncTableComment(
				Model.table,
				tableComment,
				currentTableComment,
			);

			let addedColumnNames = new Set<string>();

			if (this.shouldSyncColumns(options)) {
				addedColumnNames = await this.syncMissingColumns(
					Model.table,
					schema,
					installedSchema.columnInfo,
				);
				await this.syncWidenedTextColumns(
					Model.table,
					schema,
					installedSchema,
				);
				await this.syncNullableColumns(
					Model.table,
					schema,
					installedSchema.columnInfo,
				);
			}

			if (this.shouldSyncIndexes(options)) {
				await this.syncMissingIndexes(
					Model.table,
					schema,
					installedSchema,
					addedColumnNames,
				);
			}

			return hasPotentialDiff;
		}

		await this.connection.schema.createTable(Model.table, table => {
			if (tableComment && this.dialect().supportsTableComments) {
				table.comment(tableComment);
			}

			const dialect = this.dialect();
			const indexes: DbIndexSpec[] = [];
			const foreignKeys: DbForeignKeySpec[] = [];

			for (const [fieldName, field] of Object.entries(Model.getFields())) {
				const part = field.getDbSchema({
					model: Model,
					fieldName,
					dialect,
					table,
				});

				indexes.push(...(part.indexes ?? []));
				foreignKeys.push(...(part.foreignKeys ?? []));
			}

			for (const index of indexes) {
				installIndex(table, index, dialect);
			}

			for (const foreignKey of foreignKeys) {
				installForeignKey(table, foreignKey);
			}
		});

		return true;
	}

	/**
	 * Synchronizes a model-owned table comment only when its value changed.
	 *
	 * @param tableName - Existing database table name.
	 * @param comment - Normalized comment declared by the model.
	 * @param currentComment - Comment currently stored by the database.
	 * @returns Promise that resolves when any required comment change completes.
	 */
	private async syncTableComment(
		tableName: string,
		comment: string | null,
		currentComment: string | null | undefined,
	): Promise<void> {
		if (!comment) return;
		if (!this.dialect().supportsTableComments) return;
		if (comment === normalizeDatabaseComment(currentComment)) return;

		await this.connection.schema.alterTable(tableName, table => {
			table.comment(comment);
		});
	}

	/**
	 * Resolves whether model columns should be synchronized for this install.
	 *
	 * @param options - Per-install overrides.
	 * @returns Whether safe column synchronization is enabled.
	 */
	private shouldSyncColumns(options: DatabaseInstallOptions): boolean {
		return options.syncColumns ?? this.options.syncColumns ?? true;
	}

	/**
	 * Resolves whether model indexes should be synchronized for this install.
	 *
	 * @param options - Per-install overrides.
	 * @returns Whether missing-index synchronization is enabled.
	 */
	private shouldSyncIndexes(options: DatabaseInstallOptions): boolean {
		return options.syncIndexes ?? this.options.syncIndexes ?? true;
	}

	/**
	 * Adds model columns missing from an existing table.
	 *
	 * @param tableName - Existing database table name.
	 * @param schema - Current model schema.
	 * @param columnInfo - Column metadata captured before synchronization.
	 * @returns Names of columns added during this synchronization pass.
	 */
	private async syncMissingColumns(
		tableName: string,
		schema: Required<DbSchemaPart>,
		columnInfo: Record<string, unknown>,
	): Promise<Set<string>> {
		const existingColumnNames = new Set(Object.keys(columnInfo));
		const missingColumns = schema.columns.filter(column => {
			return !existingColumnNames.has(column.name);
		});

		if (missingColumns.length === 0) {
			return new Set();
		}

		const missingColumnNames = new Set(
			missingColumns.map(column => column.name),
		);
		const nextColumnNames = new Set([
			...existingColumnNames,
			...missingColumnNames,
		]);

		const newColumnIndexes = schema.indexes.filter(index => {
			return index.columns.some(column => {
				return missingColumnNames.has(indexColumnName(column));
			})
				&& index.columns.every(column => {
					return nextColumnNames.has(indexColumnName(column));
				});
		});
		const newColumnForeignKeys = schema.foreignKeys.filter(foreignKey => {
			return missingColumnNames.has(foreignKey.column);
		});

		await this.connection.schema.alterTable(tableName, table => {
			for (const column of missingColumns) {
				installColumn(table, column);
			}

			for (const index of newColumnIndexes) {
				installIndex(table, index, this.dialect());
			}

			for (const foreignKey of newColumnForeignKeys) {
				installForeignKey(table, foreignKey);
			}
		});

		return missingColumnNames;
	}

	/**
	 * Relaxes existing columns that are optional in the current model.
	 *
	 * @param tableName - Existing database table name.
	 * @param schema - Current model schema.
	 * @param columnInfo - Column metadata captured before synchronization.
	 * @returns Promise that resolves when nullable columns are synchronized.
	 */
	private async syncNullableColumns(
		tableName: string,
		schema: Required<DbSchemaPart>,
		columnInfo: Record<string, unknown>,
	): Promise<void> {
		const columnsToRelax = schema.columns.filter(column => {
			if (column.primary || column.nullable === false) return false;

			return columnAllowsNull(columnInfo[column.name]) === false;
		});

		if (columnsToRelax.length === 0) return;

		await this.connection.schema.alterTable(tableName, table => {
			for (const column of columnsToRelax) {
				installColumn(table, column, {
					alter: true,
					alterNullable: true,
					applyDefault: false,
					applyComment: false,
				});
			}
		});
	}

	/**
	 * Widens existing non-indexed string columns required by text model fields.
	 *
	 * @param tableName - Existing database table name.
	 * @param schema - Current model schema.
	 * @param installedSchema - Column and index metadata captured before sync.
	 * @returns Promise that resolves when safe text widening completes.
	 */
	private async syncWidenedTextColumns(
		tableName: string,
		schema: Required<DbSchemaPart>,
		installedSchema: InstalledTableSchema,
	): Promise<void> {
		const columnsToWiden = schema.columns.filter(column => {
			return columnNeedsTextWidening(
				column,
				installedSchema.columnInfo[column.name],
			)
				&& !isColumnIndexed(column.name, installedSchema.indexes);
		});

		if (columnsToWiden.length === 0) return;

		await this.connection.schema.alterTable(tableName, table => {
			for (const column of columnsToWiden) {
				installColumn(table, column, {
					alter: true,
					alterType: true,
					applyDefault: false,
					applyComment: false,
				});
			}
		});
	}

	/**
	 * Adds model indexes missing from an existing table.
	 *
	 * Indexes involving columns added in this pass are skipped here because
	 * `syncMissingColumns()` creates them alongside those columns.
	 * Each remaining index is installed separately so a concurrent application
	 * process can win the same synchronization race without preventing later
	 * indexes from being considered. A failed addition is accepted only when a
	 * fresh schema read confirms that the required index now exists.
	 *
	 * @param tableName - Existing database table name.
	 * @param schema - Current model schema.
	 * @param installedSchema - Column and index metadata captured before sync.
	 * @param addedColumnNames - Columns created earlier in this install pass.
	 * @returns Promise that resolves when missing indexes are synchronized.
	 */
	private async syncMissingIndexes(
		tableName: string,
		schema: Required<DbSchemaPart>,
		installedSchema: InstalledTableSchema,
		addedColumnNames: Set<string>,
	): Promise<void> {
		const existingColumnNames = new Set([
			...Object.keys(installedSchema.columnInfo),
			...addedColumnNames,
		]);
		const missingIndexes = findMissingIndexes(
			schema.indexes,
			installedSchema.indexes,
			existingColumnNames,
		).filter(missingIndex => {
			return !missingIndex.blocked
				&& !missingIndex.index.columns.some(column => {
					return addedColumnNames.has(indexColumnName(column));
				});
		});

		if (missingIndexes.length === 0) return;

		for (const missingIndex of missingIndexes) {
			try {
				await this.connection.schema.alterTable(tableName, table => {
					installIndex(table, missingIndex.index, this.dialect());
				});
			} catch (error) {
				const currentIndexes = await this.getTableIndexes(tableName);
				const installedConcurrently = currentIndexes.some(index => {
					return indexMatches(missingIndex.index, index);
				});

				if (!installedConcurrently) throw error;
			}
		}
	}

	private async countRowsWithNull(
		tableName: string,
		columnName: string,
	): Promise<number> {
		const result = await this.connection(tableName)
			.whereNull(columnName)
			.count<{ total: number | string }[]>({
				total: '*',
			});

		return Number(result[0]?.total ?? 0);
	}

	/**
	 * Loads reusable column and index metadata for one existing table.
	 *
	 * @param tableName - Existing database table name.
	 * @returns Column and index metadata used by every synchronization step.
	 */
	private async installedTableSchema(tableName: string): Promise<InstalledTableSchema> {
		const [
			columnInfo,
			indexes,
		] = await Promise.all([
			this.connection(tableName).columnInfo(),
			this.getTableIndexes(tableName),
		]);

		return {
			columnInfo,
			indexes,
		};
	}

	/**
	 * Detects whether an existing table may need a post-install schema report.
	 *
	 * This mirrors the inexpensive metadata checks used by `diff()` without
	 * running row-count queries. A fully synchronized table can therefore skip
	 * the second complete inspection previously performed after every install.
	 *
	 * @param tableName - Existing database table name.
	 * @param schema - Current model schema.
	 * @param installedSchema - Reusable live table metadata.
	 * @returns Whether the initial table shape contained a potential difference.
	 */
	private tableHasPotentialDiff(
		tableName: string,
		schema: Required<DbSchemaPart>,
		installedSchema: InstalledTableSchema,
	): boolean {
		const existingColumnNames = new Set(
			Object.keys(installedSchema.columnInfo),
		);

		for (const column of schema.columns) {
			const info = installedSchema.columnInfo[column.name];

			if (!info) return true;

			const databaseNullable = columnAllowsNull(info);
			const modelNullable = modelColumnAllowsNull(column);

			if (
				databaseNullable !== null
				&& databaseNullable !== modelNullable
			) {
				return true;
			}

			if (columnTypeDifference(
				tableName,
				column,
				info,
				installedSchema.indexes,
			)) {
				return true;
			}
		}

		return findMissingIndexes(
			schema.indexes,
			installedSchema.indexes,
			existingColumnNames,
		).length > 0;
	}

	/**
	 * Reads existing comments for models that declare table comments.
	 *
	 * @param models - Models participating in this install pass.
	 * @returns Existing comments keyed by database table name.
	 */
	private async tableCommentsFor(
		models: ActiveRecordClass[],
	): Promise<Map<string, string | null>> {
		const tableNames = models
			.filter(Model => normalizeDatabaseComment(Model.comment))
			.map(Model => Model.table);

		if (tableNames.length === 0) {
			return new Map();
		}

		return this.dialect().getTableComments(this.connection, tableNames);
	}

	/**
	 * Reads normalized index metadata for one table through the active dialect.
	 *
	 * @param tableName - Existing database table name.
	 * @returns Normalized primary, unique, normal, and vector indexes.
	 */
	private async getTableIndexes(tableName: string): Promise<TableIndexSpec[]> {
		return this.dialect().getTableIndexes(this.connection, tableName);
	}

	/**
	 * Reports schema differences that may remain after safe synchronization.
	 *
	 * @param models - Models whose pre-install metadata contained differences.
	 * @param options - Per-install reporting options.
	 * @returns Promise that resolves after reporting completes.
	 */
	private async reportDiffAfterInstall(
		models: ActiveRecordClass[],
		options: DatabaseInstallOptions,
	): Promise<void> {
		const reporter = options.reportSchemaDiff
			?? this.options.reportSchemaDiff
			?? 'warn';

		if (reporter === false) return;
		if (models.length === 0) return;

		const diffs = await this.diff(...models);

		if (diffs.length === 0) return;

		if (reporter === 'warn') {
			console.warn(this.formatDiff(diffs));
			return;
		}

		await reporter(diffs, this);
	}

	/**
	 * Returns the dialect associated with this database connection.
	 */
	private dialect(): DatabaseDialect {
		return databaseDialectForConnection(this.connection);
	}
}

function installColumn(
	table: Knex.TableBuilder,
	column: DbColumnSpec,
	options: InstallColumnOptions = {},
): void {
	writeDbColumn(table, column, options);
}

function installIndex(
	table: Knex.TableBuilder,
	index: DbIndexSpec,
	dialect: DatabaseDialect,
): void {
	const columns = indexColumnsForKnex(table, index.columns);

	if (index.type === 'vector') {
		if (!dialect.supportsVectorIndexes) return;

		table.index(columns, index.name, 'vector');
		return;
	}

	if (index.unique) {
		table.unique(columns, index.name);
		return;
	}

	table.index(columns, index.name);
}

function installForeignKey(
	table: Knex.TableBuilder,
	foreignKey: DbForeignKeySpec,
): void {
	let builder = table
		.foreign(foreignKey.column)
		.references(foreignKey.referencesColumn)
		.inTable(foreignKey.referencesTable);

	if (foreignKey.onDelete) {
		builder = builder.onDelete(foreignKey.onDelete);
	}

	if (foreignKey.onUpdate) {
		builder.onUpdate(foreignKey.onUpdate);
	}
}

function indexColumnsForKnex(
	table: Knex.TableBuilder,
	columns: DbIndexColumnSpec[],
): string | (string | Knex.Raw)[] {
	const normalizedColumns = columns.map(column => {
		if (typeof column === 'string' || !column.order) return indexColumnName(column);

		const client = (table as unknown as { client: Knex }).client;

		return client.raw(`?? ${column.order}`, [column.name]);
	});

	return normalizedColumns.length === 1 && typeof normalizedColumns[0] === 'string'
		? normalizedColumns[0]
		: normalizedColumns;
}

function findMissingIndexes(
	requiredIndexes: DbIndexSpec[],
	existingIndexes: TableIndexSpec[],
	existingColumnNames: Set<string>,
): MissingIndex[] {
	return requiredIndexes.flatMap(index => {
		const missingColumns = index.columns
			.map(indexColumnName)
			.filter(column => {
				return !existingColumnNames.has(column);
			});

		if (missingColumns.length > 0) {
			return [];
		}

		if (existingIndexes.some(existingIndex => indexMatches(index, existingIndex))) {
			return [];
		}

		const blocked = Boolean(
			index.name && existingIndexes.some(existingIndex => {
				return existingIndex.name === index.name;
			}),
		);

		return [{
			index,
			blocked,
			message: missingIndexMessage(index, blocked),
		}];
	});
}

function indexMatches(
	requiredIndex: DbIndexSpec,
	existingIndex: TableIndexSpec,
): boolean {
	if (existingIndex.primary) return false;
	if ((requiredIndex.type ?? 'normal') !== (existingIndex.type ?? 'normal')) return false;
	if (Boolean(requiredIndex.unique) !== existingIndex.unique) return false;

	const requiredColumns = requiredIndex.columns.map(normalizeIndexColumn);

	if (requiredColumns.length !== existingIndex.columns.length) return false;

	return requiredColumns.every((requiredColumn, index) => {
		const existingColumn = existingIndex.columns[index];

		if (requiredColumn.name !== existingColumn.name) return false;

		return !requiredColumn.order || requiredColumn.order === existingColumn.order;
	});
}

function normalizeIndexColumn(column: DbIndexColumnSpec): NormalizedIndexColumn {
	return typeof column === 'string'
		? { name: column }
		: column;
}

function indexColumnName(column: DbIndexColumnSpec): string {
	return typeof column === 'string'
		? column
		: column.name;
}

function missingIndexMessage(index: DbIndexSpec, blocked: boolean): string {
	const name = index.name ? ` ${index.name}` : '';
	const blockedMessage = blocked
		? ' A different index with that name already exists.'
		: '';

	return `Index${name} on ${describeIndex(index)} is missing.${blockedMessage}`;
}

function describeIndex(index: DbIndexSpec): string {
	const columns = index.columns.map(column => {
		if (typeof column === 'string' || !column.order) return indexColumnName(column);

		return `${column.name} ${column.order.toUpperCase()}`;
	});
	const type = index.type === 'vector' ? 'vector ' : '';

	return `${type}(${columns.join(', ')})`;
}

function modelColumnAllowsNull(column: DbColumnSpec): boolean {
	return !(column.primary || column.nullable === false);
}

function describeColumn(column: DbColumnSpec): string {
	const nullable = modelColumnAllowsNull(column) ? 'nullable' : 'not null';

	return `${column.type} ${nullable}`;
}

function describeColumnInfo(info: unknown): string {
	const type = columnInfoType(info) ?? 'unknown';
	const maxLength = columnInfoMaxLength(info);

	return maxLength ? `${type}(${maxLength})` : type;
}

function columnTypeDifference(
	tableName: string,
	column: DbColumnSpec,
	info: unknown,
	tableIndexes: TableIndexSpec[],
): DatabaseSchemaDifference | null {
	if (!columnNeedsTextWidening(column, info)) return null;

	const blocked = isColumnIndexed(column.name, tableIndexes);

	return {
		kind: 'type_mismatch',
		table: tableName,
		column: column.name,
		databaseValue: describeColumnInfo(info),
		modelValue: describeColumn(column),
		blocked,
		message: typeMismatchMessage(
			tableName,
			column.name,
			describeColumnInfo(info),
			describeColumn(column),
			blocked,
		),
	};
}

function typeMismatchMessage(
	tableName: string,
	columnName: string,
	databaseValue: string,
	modelValue: string,
	blocked: boolean,
): string {
	const blocker = blocked ? ' Column is indexed, so this must be changed manually.' : '';

	return `Column ${tableName}.${columnName} type differs: database is ${databaseValue}, model expects ${modelValue}.${blocker}`;
}

function columnNeedsTextWidening(
	column: DbColumnSpec,
	info: unknown,
): boolean {
	const modelType = normalizeColumnType(column.type);

	if (modelType !== 'text' && modelType !== 'longtext') return false;

	const databaseType = columnInfoType(info);

	if (!databaseType) return false;
	if (modelType === 'longtext' && isTextColumnType(databaseType)) {
		return databaseType.toLowerCase() !== 'longtext';
	}
	if (modelType === 'text' && isTextColumnType(databaseType)) return false;

	return isStringColumnType(databaseType);
}

function columnInfoType(info: unknown): string | null {
	if (!info || typeof info !== 'object') return null;

	const type = (info as { type?: unknown }).type;

	return typeof type === 'string' && type !== '' ? type : null;
}

function columnInfoMaxLength(info: unknown): number | null {
	if (!info || typeof info !== 'object') return null;

	const maxLength = (info as { maxLength?: unknown }).maxLength;

	if (typeof maxLength === 'number' && Number.isFinite(maxLength)) return maxLength;
	if (typeof maxLength === 'string' && maxLength.trim() !== '') {
		const parsed = Number(maxLength);

		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function isTextColumnType(type: string): boolean {
	return /^(?:tinytext|text|mediumtext|longtext)$/i.test(normalizeColumnType(type));
}

function isStringColumnType(type: string): boolean {
	return /^(?:char|varchar|string)$/i.test(normalizeColumnType(type));
}

function normalizeColumnType(type: string): string {
	return type.trim().toLowerCase().replace(/\(.+$/, '');
}

function isColumnIndexed(
	columnName: string,
	tableIndexes: TableIndexSpec[],
): boolean {
	return tableIndexes.some(index => {
		return index.columns.some(column => column.name === columnName);
	});
}

function nullableMismatchMessage(
	tableName: string,
	columnName: string,
	databaseNullable: boolean,
	modelNullable: boolean,
	rowsWithNull: number | undefined,
): string {
	const databaseValue = databaseNullable ? 'nullable' : 'not null';
	const modelValue = modelNullable ? 'nullable' : 'not null';
	const blocker = rowsWithNull
		? `; ${rowsWithNull} rows currently contain NULL`
		: '';

	return `Column ${tableName}.${columnName} nullability differs: database is ${databaseValue}, model expects ${modelValue}${blocker}.`;
}

function columnAllowsNull(info: unknown): boolean | null {
	if (!info || typeof info !== 'object') return null;

	const nullable = (info as { nullable?: unknown }).nullable;

	if (typeof nullable === 'boolean') return nullable;

	if (typeof nullable === 'string') {
		const value = nullable.toLowerCase().trim();

		if (['1', 'true', 'yes'].includes(value)) return true;
		if (['0', 'false', 'no'].includes(value)) return false;
	}

	return null;
}

function resolveInstallArgs(input: InstallArgs): {
	models: ActiveRecordClass[];
	options: DatabaseInstallOptions;
} {
	const [
		first,
		...rest
	] = input;

	if (isInstallOptions(first)) {
		return {
			models: rest as ActiveRecordClass[],
			options: first,
		};
	}

	return {
		models: input as ActiveRecordClass[],
		options: {},
	};
}

function isInstallOptions(
	input: ActiveRecordClass | DatabaseInstallOptions | undefined,
): input is DatabaseInstallOptions {
	return Boolean(input && typeof input === 'object');
}
