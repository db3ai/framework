import { normalizeDatabaseComment } from '@db3.ai/pure';
import type { ActiveRecordClass } from '../ActiveRecord';
import { Database } from '../Database';
import type { DatabaseDialect } from '../dialects';
import type { DbIndexColumnSpec } from '../FieldType';
import type {
	SchemaColumn,
	SchemaForeignKey,
	SchemaIndex,
	SchemaIndexColumn,
	SchemaSnapshot,
	SchemaTable,
	SchemaValue,
} from './contracts';
import { defaultSchemaForeignKeyName, defaultSchemaIndexName } from './SchemaNames';

/**
 * Collects a deterministic serializable schema snapshot from ActiveRecord
 * model metadata.
 *
 * @param models - Complete model registry owned by the application.
 * @param dialect - Database dialect used by fields to resolve physical types.
 * @returns Normalized desired database state sorted by physical names.
 */
export function collectModelSchema(
	models: readonly ActiveRecordClass[],
	dialect: DatabaseDialect,
): SchemaSnapshot {
	const tables = models.map(Model => collectModelTable(Model, dialect));
	const tableNames = new Set<string>();

	for (const table of tables) {
		if (tableNames.has(table.name)) {
			throw new Error(`Duplicate model table "${table.name}" in migration registry.`);
		}

		tableNames.add(table.name);
	}

	return {
		formatVersion: 1,
		dialect: dialect.name,
		tables: tables.sort(compareByName),
	};
}

/**
 * Collects one normalized table from an ActiveRecord class.
 *
 * @param Model - ActiveRecord model defining the table.
 * @param dialect - Database dialect used by fields to resolve physical types.
 * @returns Deterministic normalized table schema.
 */
function collectModelTable(
	Model: ActiveRecordClass,
	dialect: DatabaseDialect,
): SchemaTable {
	const schema = Database.getSchema(Model, dialect);
	const columns = schema.columns.map(column => {
		const normalized: SchemaColumn = {
			name: column.name,
			type: normalizeSchemaColumnType(column.type),
			nullable: !(column.primary || column.nullable === false),
			primary: Boolean(column.primary),
			unique: Boolean(column.unique),
			comment: normalizeDatabaseComment(column.comment),
		};

		if (column.default !== undefined) {
			normalized.default = normalizeSchemaValue(
				column.default,
				`${Model.table}.${column.name} default`,
			);
		}

		return normalized;
	});
	const indexes = schema.indexes.map(index => {
		const indexColumns = index.columns.map(normalizeIndexColumn);
		const unique = Boolean(index.unique);
		const type = index.type ?? 'normal';

		return {
			name: index.name ?? defaultSchemaIndexName(
				Model.table,
				indexColumns,
				unique,
				type,
			),
			columns: indexColumns,
			unique,
			type,
		} satisfies SchemaIndex;
	});
	const foreignKeys = schema.foreignKeys.map(foreignKey => {
		const normalized: SchemaForeignKey = {
			name: defaultSchemaForeignKeyName(Model.table, foreignKey.column),
			column: foreignKey.column,
			referencesTable: foreignKey.referencesTable,
			referencesColumn: foreignKey.referencesColumn,
		};

		if (foreignKey.onDelete) normalized.onDelete = foreignKey.onDelete;
		if (foreignKey.onUpdate) normalized.onUpdate = foreignKey.onUpdate;

		return normalized;
	});

	assertUniqueNames(columns, `${Model.table} column`);
	assertUniqueNames(indexes, `${Model.table} index`);
	assertUniqueNames(foreignKeys, `${Model.table} foreign key`);

	return {
		name: Model.table,
		comment: normalizeDatabaseComment(Model.comment),
		columns: columns.sort(compareByName),
		indexes: indexes.sort(compareByName),
		foreignKeys: foreignKeys.sort(compareByName),
	};
}

/**
 * Converts one framework index column to its normalized serializable form.
 *
 * @param column - Field-owned index column metadata.
 * @returns Normalized ordered index column.
 */
function normalizeIndexColumn(column: DbIndexColumnSpec): SchemaIndexColumn {
	if (typeof column === 'string') {
		return { name: column };
	}

	const normalized: SchemaIndexColumn = { name: column.name };

	if (column.order) normalized.order = column.order;

	return normalized;
}

/**
 * Canonicalizes dialect type strings so snapshots do not change because of
 * harmless whitespace, case, or MariaDB integer display widths.
 *
 * @param input - Dialect-provided or database-inspected SQL type.
 * @returns Stable lower-case SQL type.
 */
export function normalizeSchemaColumnType(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/\bboolean\b/g, 'tinyint(1)')
		.replace(/\b(bigint|int|mediumint|smallint)\(\d+\)/g, '$1')
		.replace(/\s+/g, ' ');
}

/**
 * Converts a static field default to the JSON-safe representation permitted in
 * committed snapshots and generated migration source.
 *
 * @param input - Static database default produced by a field.
 * @param path - Human-readable location used in validation errors.
 * @returns Deterministically ordered JSON-safe value.
 */
export function normalizeSchemaValue(input: unknown, path: string): SchemaValue {
	if (input === null || typeof input === 'string' || typeof input === 'boolean') {
		return input;
	}

	if (typeof input === 'number') {
		if (!Number.isFinite(input)) {
			throw new Error(`${path} must be a finite serializable number.`);
		}

		return input;
	}

	if (Array.isArray(input)) {
		return input.map((value, index) => {
			return normalizeSchemaValue(value, `${path}[${index}]`);
		});
	}

	if (isPlainObject(input)) {
		return Object.fromEntries(
			Object.entries(input)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, value]) => {
					return [key, normalizeSchemaValue(value, `${path}.${key}`)];
				}),
		);
	}

	throw new Error(`${path} must be a static JSON-serializable value.`);
}

/**
 * Tests whether an input is a plain record that can be frozen as JSON.
 *
 * @param input - Value to inspect.
 * @returns True only for ordinary or null-prototype records.
 */
function isPlainObject(input: unknown): input is Record<string, unknown> {
	if (!input || typeof input !== 'object') return false;

	const prototype = Object.getPrototypeOf(input) as unknown;

	return prototype === Object.prototype || prototype === null;
}

/**
 * Rejects duplicate names before sorting hides their model declaration order.
 *
 * @param values - Named schema objects to validate.
 * @param description - Object kind included in validation errors.
 */
function assertUniqueNames(
	values: readonly { name: string }[],
	description: string,
): void {
	const names = new Set<string>();

	for (const value of values) {
		if (names.has(value.name)) {
			throw new Error(`Duplicate ${description} "${value.name}".`);
		}

		names.add(value.name);
	}
}

/**
 * Sort comparator for normalized named schema objects.
 *
 * @param a - First named schema object.
 * @param b - Second named schema object.
 * @returns Locale-independent lexical ordering result.
 */
function compareByName(a: { name: string }, b: { name: string }): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
