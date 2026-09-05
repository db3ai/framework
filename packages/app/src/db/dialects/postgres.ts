import type { Knex } from 'knex';
import type {
	DatabaseDialect,
	TableIndexSpec,
} from './types';
import { postgresColumnTypes } from './columnTypes';
import { vectorFromDbValue } from './mysql';

const VECTOR_MAX_DIMENSIONS = 16000;

/**
 * PostgreSQL dialect placeholder for pg/pgvector-backed applications.
 */
export const postgresDialect: DatabaseDialect = {
	name: 'postgres',
	knexClient: 'pg',
	defaultPort: 5432,
	supportsReturningRows: true,
	supportsTableComments: false,
	supportsVectorIndexes: false,
	vectorMaxDimensions: VECTOR_MAX_DIMENSIONS,
	columnTypes: postgresColumnTypes,
	vectorColumnType,
	vectorToDbValue,
	vectorFromDbValue,
	createDatabase,
	dropDatabase,
	quoteIdentifier,
	getTableIndexes,
	getTableComments,
};

/**
 * Returns the pgvector column type for configured dimensions.
 */
function vectorColumnType(dimensions?: number): string {
	return dimensions === undefined ? 'vector' : `vector(${dimensions})`;
}

/**
 * Converts app-memory vectors into pgvector text input.
 */
function vectorToDbValue(vector: readonly number[]): string {
	for (let index = 0; index < vector.length; index += 1) {
		const value = vector[index];

		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Vector value at index ${index} must be a finite number.`);
		}
	}

	return JSON.stringify(vector);
}

/**
 * Creates a PostgreSQL database for isolated integration tests.
 */
async function createDatabase(
	db: Knex,
	databaseName: string,
): Promise<void> {
	await db.raw(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
}

/**
 * Drops an isolated PostgreSQL integration-test database.
 */
async function dropDatabase(
	db: Knex,
	databaseName: string,
): Promise<void> {
	await db.raw(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
}

/**
 * Quotes a PostgreSQL identifier after the caller has validated its shape.
 */
function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Returns no table comments because PostgreSQL comment sync is not enabled.
 *
 * @param _db - Unused database connection.
 * @param _tableNames - Unused table names.
 * @returns Empty comment map.
 */
async function getTableComments(
	_db: Knex,
	_tableNames: string[],
): Promise<Map<string, string | null>> {
	return new Map();
}

/**
 * Reads PostgreSQL index metadata and normalizes it for schema diffing.
 */
async function getTableIndexes(
	db: Knex,
	tableName: string,
): Promise<TableIndexSpec[]> {
	const rows = await db
		.select<{
			index_name: string;
			column_name: string;
			column_order: number;
			is_unique: boolean;
			is_primary: boolean;
		}[]>([
			db.raw('i.relname AS index_name'),
			db.raw('a.attname AS column_name'),
			db.raw('array_position(ix.indkey, a.attnum) AS column_order'),
			db.raw('ix.indisunique AS is_unique'),
			db.raw('ix.indisprimary AS is_primary'),
		])
		.from({ t: 'pg_class' })
		.join({ n: 'pg_namespace' }, 'n.oid', 't.relnamespace')
		.join({ ix: 'pg_index' }, 'ix.indrelid', 't.oid')
		.join({ i: 'pg_class' }, 'i.oid', 'ix.indexrelid')
		.joinRaw('JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)')
		.where('t.relname', tableName)
		.where('n.nspname', 'public')
		.orderBy('i.relname')
		.orderBy('column_order');
	const indexes = new Map<string, TableIndexSpec>();

	for (const row of rows) {
		const index = indexes.get(row.index_name) ?? {
			name: row.index_name,
			columns: [],
			unique: Boolean(row.is_unique),
			primary: Boolean(row.is_primary),
		};

		index.columns.push({
			name: row.column_name,
		});
		indexes.set(row.index_name, index);
	}

	return [...indexes.values()];
}
