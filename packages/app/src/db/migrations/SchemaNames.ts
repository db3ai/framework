import { createHash } from 'node:crypto';
import type { SchemaIndexColumn } from './contracts';

const MARIADB_IDENTIFIER_MAX_LENGTH = 64;

/**
 * Builds the stable name used for a model-owned database index.
 *
 * @param tableName - Physical database table name.
 * @param columns - Ordered columns included in the index.
 * @param unique - Whether the index enforces uniqueness.
 * @param type - Normal or vector database index type.
 * @returns MariaDB-safe deterministic index name.
 */
export function defaultSchemaIndexName(
	tableName: string,
	columns: readonly SchemaIndexColumn[],
	unique: boolean,
	type: 'normal' | 'vector',
): string {
	const suffix = type === 'vector'
		? 'vector_index'
		: unique ? 'unique' : 'index';

	return fitSchemaIdentifier([
		tableName,
		...columns.map(column => column.name),
		suffix,
	].join('_'));
}

/**
 * Builds the stable name used for a model-owned foreign-key constraint.
 *
 * @param tableName - Physical database table name.
 * @param columnName - Local physical database column.
 * @returns MariaDB-safe deterministic foreign-key name.
 */
export function defaultSchemaForeignKeyName(
	tableName: string,
	columnName: string,
): string {
	return fitSchemaIdentifier(`${tableName}_${columnName}_foreign`);
}

/**
 * Truncates an identifier with a stable hash while respecting MariaDB's
 * 64-character identifier limit.
 *
 * @param identifier - Preferred human-readable identifier.
 * @returns Original or deterministically shortened identifier.
 */
export function fitSchemaIdentifier(identifier: string): string {
	if (identifier.length <= MARIADB_IDENTIFIER_MAX_LENGTH) {
		return identifier;
	}

	const hash = createHash('sha256').update(identifier).digest('hex').slice(0, 8);
	const prefixLength = MARIADB_IDENTIFIER_MAX_LENGTH - hash.length - 1;

	return `${identifier.slice(0, prefixLength)}_${hash}`;
}
