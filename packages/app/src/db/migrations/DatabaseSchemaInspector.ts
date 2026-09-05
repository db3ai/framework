import type { Knex } from 'knex';
import type { DatabaseDialect, TableIndexSpec } from '../dialects';
import type {
	SchemaColumn,
	SchemaForeignKey,
	SchemaIndex,
	SchemaSnapshot,
	SchemaTable,
	SchemaValue,
} from './contracts';
import { normalizeSchemaColumnType, normalizeSchemaValue } from './ModelSchemaCollector';

interface MariaDbTableRow {
	tableName?: unknown;
}

interface MariaDbColumnRow {
	tableName?: unknown;
	columnName?: unknown;
	columnType?: unknown;
	nullable?: unknown;
	columnKey?: unknown;
	defaultValue?: unknown;
	extra?: unknown;
}

interface MariaDbForeignKeyRow {
	tableName?: unknown;
	name?: unknown;
	columnName?: unknown;
	referencesTable?: unknown;
	referencesColumn?: unknown;
	onDelete?: unknown;
	onUpdate?: unknown;
}

interface MariaDbCheckConstraintRow {
	tableName?: unknown;
	checkClause?: unknown;
}

/**
 * Reads the model-owned subset of a live MariaDB database into the same
 * normalized representation used by model snapshots.
 *
 * Extra database objects are intentionally ignored. This lets an older
 * blue/green application release accept additive objects introduced by a newer
 * release while still detecting missing or incompatible requirements. Database
 * comments are treated as non-runtime metadata: committed snapshots retain
 * them, while compatibility checks ignore live comment drift.
 *
 * @param db - Knex connection used for information-schema reads.
 * @param desired - Current model snapshot defining objects that must be checked.
 * @param dialect - MariaDB dialect metadata and index inspection functions.
 * @returns Live model-owned database state.
 */
export async function inspectDatabaseSchema(
	db: Knex,
	desired: SchemaSnapshot,
	dialect: DatabaseDialect,
): Promise<SchemaSnapshot> {
	if (dialect.name !== 'mariadb' || desired.dialect !== 'mariadb') {
		throw new Error('Automatic database schema inspection currently supports MariaDB only.');
	}

	if (desired.tables.length === 0) {
		return {
			formatVersion: 1,
			dialect: desired.dialect,
			tables: [],
		};
	}

	const tableNames = desired.tables.map(table => table.name);
	const [tableRows, columnRows, foreignKeyRows, checkConstraintRows] = await Promise.all([
		readTableRows(db, tableNames),
		readColumnRows(db, tableNames),
		readForeignKeyRows(db, tableNames),
		readCheckConstraintRows(db, tableNames),
	]);
	const existingTables = new Set(tableRows.flatMap(row => {
		const tableName = stringValue(row.tableName);

		return tableName ? [tableName] : [];
	}));
	const tables = await Promise.all(desired.tables.flatMap(desiredTable => {
		if (!existingTables.has(desiredTable.name)) return [];

		return [inspectTable(
			dialect,
			db,
			desiredTable,
			columnRows,
			foreignKeyRows,
			checkConstraintRows,
		)];
	}));

	return {
		formatVersion: 1,
		dialect: desired.dialect,
		tables: tables.sort(compareByName),
	};
}

/**
 * Reads and normalizes one existing model-owned table.
 *
 * @param dialect - MariaDB dialect metadata reader.
 * @param db - Knex connection used for index inspection.
 * @param desired - Desired table requirements used to filter extra objects.
 * @param columnRows - Batched information-schema column rows.
 * @param foreignKeyRows - Batched information-schema foreign-key rows.
 * @param checkConstraintRows - Batched information-schema check constraints.
 * @returns Live normalized table definition.
 */
async function inspectTable(
	dialect: DatabaseDialect,
	db: Knex,
	desired: SchemaTable,
	columnRows: readonly MariaDbColumnRow[],
	foreignKeyRows: readonly MariaDbForeignKeyRow[],
	checkConstraintRows: readonly MariaDbCheckConstraintRow[],
): Promise<SchemaTable> {
	const databaseIndexes = await dialect.getTableIndexes(db, desired.name);
	const columns = desired.columns.flatMap(desiredColumn => {
		const row = columnRows.find(columnRow => {
			return stringValue(columnRow.tableName) === desired.name
				&& stringValue(columnRow.columnName) === desiredColumn.name;
		});

		return row
			? [normalizeDatabaseColumn(
				row,
				desiredColumn,
				databaseIndexes,
				checkConstraintRows,
			)]
			: [];
	});
	const indexes = desired.indexes.flatMap(desiredIndex => {
		const index = databaseIndexes.find(candidate => candidate.name === desiredIndex.name);

		return index ? [normalizeDatabaseIndex(index, desiredIndex)] : [];
	});
	const foreignKeys = desired.foreignKeys.flatMap(desiredForeignKey => {
		const row = foreignKeyRows.find(candidate => {
			return stringValue(candidate.tableName) === desired.name
				&& stringValue(candidate.name) === desiredForeignKey.name;
		});

		return row ? [normalizeDatabaseForeignKey(row, desiredForeignKey)] : [];
	});

	return {
		name: desired.name,
		comment: desired.comment,
		columns: columns.sort(compareByName),
		indexes: indexes.sort(compareByName),
		foreignKeys: foreignKeys.sort(compareByName),
	};
}

/**
 * Normalizes a MariaDB column row, including driver-specific default values.
 *
 * @param row - Information-schema column row.
 * @param desired - Desired column used to normalize equivalent representations.
 * @param indexes - Installed indexes used to infer unique constraints.
 * @param checkConstraintRows - Installed table check constraints.
 * @returns Live normalized column.
 */
function normalizeDatabaseColumn(
	row: MariaDbColumnRow,
	desired: SchemaColumn,
	indexes: readonly TableIndexSpec[],
	checkConstraintRows: readonly MariaDbCheckConstraintRow[],
): SchemaColumn {
	const rawType = stringValue(row.columnType) ?? desired.type;
	const extra = stringValue(row.extra)?.toLowerCase() ?? '';
	const physicalType = normalizeSchemaColumnType(
		extra.includes('auto_increment') && !rawType.toLowerCase().includes('auto_increment')
			? `${rawType} auto_increment`
			: rawType,
	);
	const type = normalizeMariaDbJsonAlias(
		physicalType,
		desired,
		stringValue(row.tableName) ?? '',
		checkConstraintRows,
	);
	const column: SchemaColumn = {
		name: desired.name,
		type,
		nullable: String(row.nullable ?? '').toUpperCase() === 'YES',
		primary: String(row.columnKey ?? '').toUpperCase() === 'PRI',
		unique: indexes.some(index => {
			return !index.primary
				&& index.unique
				&& index.columns.length === 1
				&& index.columns[0]?.name === desired.name;
		}),
		comment: desired.comment,
	};
	const defaultValue = normalizeDatabaseDefault(row.defaultValue, desired);

	if (defaultValue.present) {
		column.default = defaultValue.value;
	}

	return column;
}

/**
 * Treats MariaDB's LONGTEXT-backed JSON alias as the desired JSON type only
 * when the installed table also retains its generated JSON_VALID constraint.
 *
 * @param physicalType - Normalized type reported by information_schema.COLUMNS.
 * @param desired - Desired model column definition.
 * @param tableName - Physical database table name.
 * @param checkConstraintRows - Installed table check constraints.
 * @returns Logical JSON type or the unchanged physical type.
 */
function normalizeMariaDbJsonAlias(
	physicalType: string,
	desired: SchemaColumn,
	tableName: string,
	checkConstraintRows: readonly MariaDbCheckConstraintRow[],
): string {
	if (desired.type !== 'json' || physicalType !== 'longtext') {
		return physicalType;
	}

	const hasJsonValidation = checkConstraintRows.some(row => {
		if (stringValue(row.tableName) !== tableName) return false;

		const clause = stringValue(row.checkClause)
			?.toLowerCase()
			.replace(/[`"']/g, '')
			.replace(/\s+/g, '');

		return clause?.includes(`json_valid(${desired.name.toLowerCase()})`) ?? false;
	});

	return hasJsonValidation ? 'json' : physicalType;
}

/**
 * Normalizes one installed index while treating unspecified model ordering as
 * dialect-default ordering.
 *
 * @param installed - MariaDB index metadata.
 * @param desired - Desired index definition.
 * @returns Live normalized model-owned index.
 */
function normalizeDatabaseIndex(
	installed: TableIndexSpec,
	desired: SchemaIndex,
): SchemaIndex {
	return {
		name: installed.name,
		columns: installed.columns.map((column, position) => {
			const desiredColumn = desired.columns[position];
			const normalized = { name: column.name } as SchemaIndex['columns'][number];

			if (desiredColumn?.order && column.order) {
				normalized.order = column.order;
			}

			return normalized;
		}),
		unique: installed.unique,
		type: installed.type ?? 'normal',
	};
}

/**
 * Normalizes one installed MariaDB foreign key.
 *
 * @param row - Joined key and referential-constraint metadata.
 * @param desired - Desired definition used to ignore dialect default actions.
 * @returns Live normalized model-owned foreign key.
 */
function normalizeDatabaseForeignKey(
	row: MariaDbForeignKeyRow,
	desired: SchemaForeignKey,
): SchemaForeignKey {
	const foreignKey: SchemaForeignKey = {
		name: stringValue(row.name) ?? desired.name,
		column: stringValue(row.columnName) ?? desired.column,
		referencesTable: stringValue(row.referencesTable) ?? '',
		referencesColumn: stringValue(row.referencesColumn) ?? '',
	};

	if (desired.onDelete) {
		foreignKey.onDelete = foreignKeyAction(row.onDelete) ?? 'NO ACTION';
	}

	if (desired.onUpdate) {
		foreignKey.onUpdate = foreignKeyAction(row.onUpdate) ?? 'NO ACTION';
	}

	return foreignKey;
}

interface NormalizedDefault {
	present: boolean;
	value?: SchemaValue;
}

/**
 * Normalizes MariaDB information-schema defaults against the declared model
 * value so booleans and numeric driver strings compare consistently.
 *
 * @param input - Raw MariaDB COLUMN_DEFAULT value.
 * @param desired - Desired column definition.
 * @returns Presence and normalized JSON-safe default value.
 */
function normalizeDatabaseDefault(
	input: unknown,
	desired: SchemaColumn,
): NormalizedDefault {
	const desiredHasDefault = Object.hasOwn(desired, 'default');

	if (input === null || input === undefined) {
		return desiredHasDefault && desired.default === null
			? { present: true, value: null }
			: { present: false };
	}

	if (typeof input === 'string' && input.trim().toUpperCase() === 'NULL') {
		return desiredHasDefault && desired.default === null
			? { present: true, value: null }
			: { present: false };
	}

	let value: unknown = input;

	if (typeof value === 'string') {
		value = unquoteMariaDbDefault(value);
	}

	if (typeof desired.default === 'boolean') {
		if (value === true || value === 1 || value === '1') {
			return { present: true, value: true };
		}

		if (value === false || value === 0 || value === '0') {
			return { present: true, value: false };
		}
	}

	if (typeof desired.default === 'number' && value !== '') {
		const number = Number(value);

		if (Number.isFinite(number)) {
			return { present: true, value: number };
		}
	}

	if (
		desired.default !== null
		&& typeof desired.default === 'object'
		&& typeof value === 'string'
	) {
		try {
			return {
				present: true,
				value: normalizeSchemaValue(JSON.parse(value), `${desired.name} default`),
			};
		} catch {
			// Preserve the raw string below so the schema check reports a mismatch.
		}
	}

	return {
		present: true,
		value: normalizeSchemaValue(value, `${desired.name} database default`),
	};
}

/**
 * Removes MariaDB's optional SQL quoting around literal defaults.
 *
 * @param value - Raw COLUMN_DEFAULT string.
 * @returns Unquoted literal with escaped quotes restored.
 */
function unquoteMariaDbDefault(value: string): string {
	if (value.length < 2 || value[0] !== "'" || value.at(-1) !== "'") {
		return value;
	}

	return value.slice(1, -1).replace(/''/g, "'");
}

/**
 * Reads existing model-owned table names in one metadata query.
 *
 * @param db - Knex database connection.
 * @param tableNames - Physical model table names.
 * @returns Raw MariaDB table rows.
 */
async function readTableRows(
	db: Knex,
	tableNames: readonly string[],
): Promise<MariaDbTableRow[]> {
	return await db<MariaDbTableRow>('information_schema.TABLES')
		.select({
			tableName: 'TABLE_NAME',
		})
		.whereRaw('TABLE_SCHEMA = DATABASE()')
		.whereIn('TABLE_NAME', tableNames);
}

/**
 * Reads existing model-owned column definitions in one metadata query.
 *
 * @param db - Knex database connection.
 * @param tableNames - Physical model table names.
 * @returns Raw MariaDB column rows.
 */
async function readColumnRows(
	db: Knex,
	tableNames: readonly string[],
): Promise<MariaDbColumnRow[]> {
	return await db<MariaDbColumnRow>('information_schema.COLUMNS')
		.select({
			tableName: 'TABLE_NAME',
			columnName: 'COLUMN_NAME',
			columnType: 'COLUMN_TYPE',
			nullable: 'IS_NULLABLE',
			columnKey: 'COLUMN_KEY',
			defaultValue: 'COLUMN_DEFAULT',
			extra: 'EXTRA',
		})
		.whereRaw('TABLE_SCHEMA = DATABASE()')
		.whereIn('TABLE_NAME', tableNames);
}

/**
 * Reads existing model-owned foreign keys and referential actions.
 *
 * @param db - Knex database connection.
 * @param tableNames - Physical model table names.
 * @returns Raw joined MariaDB foreign-key rows.
 */
async function readForeignKeyRows(
	db: Knex,
	tableNames: readonly string[],
): Promise<MariaDbForeignKeyRow[]> {
	return await db<MariaDbForeignKeyRow>({
		keys: 'information_schema.KEY_COLUMN_USAGE',
	})
		.join({
			constraints: 'information_schema.REFERENTIAL_CONSTRAINTS',
		}, function joinConstraints() {
			this.on('constraints.CONSTRAINT_SCHEMA', '=', 'keys.CONSTRAINT_SCHEMA')
				.andOn('constraints.CONSTRAINT_NAME', '=', 'keys.CONSTRAINT_NAME');
		})
		.select({
			tableName: 'keys.TABLE_NAME',
			name: 'keys.CONSTRAINT_NAME',
			columnName: 'keys.COLUMN_NAME',
			referencesTable: 'keys.REFERENCED_TABLE_NAME',
			referencesColumn: 'keys.REFERENCED_COLUMN_NAME',
			onDelete: 'constraints.DELETE_RULE',
			onUpdate: 'constraints.UPDATE_RULE',
		})
		.whereRaw('keys.CONSTRAINT_SCHEMA = DATABASE()')
		.whereIn('keys.TABLE_NAME', tableNames)
		.whereNotNull('keys.REFERENCED_TABLE_NAME');
}

/**
 * Reads MariaDB check constraints used to distinguish the JSON alias from an
 * unconstrained LONGTEXT column.
 *
 * @param db - Knex database connection.
 * @param tableNames - Physical model table names.
 * @returns Raw MariaDB check-constraint rows.
 */
async function readCheckConstraintRows(
	db: Knex,
	tableNames: readonly string[],
): Promise<MariaDbCheckConstraintRow[]> {
	return await db<MariaDbCheckConstraintRow>('information_schema.CHECK_CONSTRAINTS')
		.select({
			tableName: 'TABLE_NAME',
			checkClause: 'CHECK_CLAUSE',
		})
		.whereRaw('CONSTRAINT_SCHEMA = DATABASE()')
		.whereIn('TABLE_NAME', tableNames);
}

/**
 * Parses one MariaDB referential action into the public contract.
 *
 * @param input - Raw information-schema rule.
 * @returns Supported normalized action or null.
 */
function foreignKeyAction(
	input: unknown,
): SchemaForeignKey['onDelete'] | null {
	const action = String(input ?? '').trim().toUpperCase();

	if (
		action === 'CASCADE'
		|| action === 'RESTRICT'
		|| action === 'SET NULL'
		|| action === 'NO ACTION'
	) {
		return action;
	}

	return null;
}

/**
 * Converts unknown metadata cells to non-empty strings.
 *
 * @param input - Raw driver value.
 * @returns String value or null for empty cells.
 */
function stringValue(input: unknown): string | null {
	if (input === null || input === undefined) return null;

	const value = String(input);

	return value === '' ? null : value;
}

/**
 * Sort comparator for normalized named schema objects.
 *
 * @param a - First named object.
 * @param b - Second named object.
 * @returns Locale-independent lexical ordering result.
 */
function compareByName(a: { name: string }, b: { name: string }): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
