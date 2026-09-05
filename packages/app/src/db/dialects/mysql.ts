import { Buffer } from 'node:buffer';
import type { Knex } from 'knex';
import type {
	DatabaseDialect,
	TableIndexSpec,
} from './types';
import { mysqlColumnTypes } from './columnTypes';

const VECTOR_BYTES_PER_ENTRY = 4;
const VECTOR_MAX_DIMENSIONS = 16383;

interface MySqlIndexRow {
	Key_name?: unknown;
	Column_name?: unknown;
	Seq_in_index?: unknown;
	Non_unique?: unknown;
	Collation?: unknown;
	Index_type?: unknown;
}

interface MySqlTableCommentRow {
	tableName?: unknown;
	comment?: unknown;
}

/**
 * MySQL dialect used by the framework database layer.
 */
export const mysqlDialect: DatabaseDialect = {
	name: 'mysql',
	knexClient: 'mysql2',
	defaultPort: 3306,
	supportsReturningRows: false,
	supportsTableComments: true,
	supportsVectorIndexes: false,
	vectorMaxDimensions: VECTOR_MAX_DIMENSIONS,
	columnTypes: mysqlColumnTypes,
	vectorColumnType,
	vectorToDbValue: vectorToMysqlBuffer,
	vectorFromDbValue,
	createDatabase: createMysqlDatabase,
	dropDatabase: dropMysqlDatabase,
	quoteIdentifier: quoteMysqlIdentifier,
	getTableIndexes: getMysqlTableIndexes,
	getTableComments: getMysqlTableComments,
};

/**
 * Returns the native MySQL VECTOR column type for configured dimensions.
 */
function vectorColumnType(dimensions?: number): string {
	return dimensions === undefined ? 'vector' : `vector(${dimensions})`;
}

/**
 * Creates a UTF-8 MySQL database for isolated integration tests.
 */
async function createMysqlDatabase(
	db: Knex,
	databaseName: string,
): Promise<void> {
	await db.raw(
		`CREATE DATABASE ${quoteMysqlIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
	);
}

/**
 * Drops an isolated MySQL integration-test database.
 */
async function dropMysqlDatabase(
	db: Knex,
	databaseName: string,
): Promise<void> {
	await db.raw(`DROP DATABASE IF EXISTS ${quoteMysqlIdentifier(databaseName)}`);
}

/**
 * Quotes a MySQL identifier after the caller has validated its shape.
 */
function quoteMysqlIdentifier(identifier: string): string {
	return `\`${identifier.replace(/`/g, '``')}\``;
}

/**
 * Reads MySQL or MariaDB index metadata and normalizes it for schema diffing.
 */
async function getMysqlTableIndexes(
	db: Knex,
	tableName: string,
): Promise<TableIndexSpec[]> {
	const result = await db.raw('SHOW INDEX FROM ??', [tableName]);
	const rows = extractMysqlRows(result) as MySqlIndexRow[];
	const indexes = new Map<string, TableIndexSpec>();

	for (const row of rows) {
		const name = stringValue(row.Key_name);
		const column = stringValue(row.Column_name);

		if (!name || !column) continue;

		const index = indexes.get(name) ?? {
			name,
			columns: [],
			unique: Number(row.Non_unique ?? 1) === 0,
			primary: name === 'PRIMARY',
			type: indexType(row.Index_type),
		};

		index.columns.push({
			name: column,
			order: indexColumnOrder(row.Collation),
		});
		indexes.set(name, index);
	}

	return [...indexes.values()].map(index => {
		return {
			...index,
			columns: index.columns.sort((a, b) => {
				const aRow = rows.find(row => {
					return stringValue(row.Key_name) === index.name
						&& stringValue(row.Column_name) === a.name;
				});
				const bRow = rows.find(row => {
					return stringValue(row.Key_name) === index.name
						&& stringValue(row.Column_name) === b.name;
				});

				return Number(aRow?.Seq_in_index ?? 0) - Number(bRow?.Seq_in_index ?? 0);
			}),
		};
	});
}

/**
 * Reads MySQL or MariaDB table comments in one metadata query.
 *
 * @param db - Database connection used for metadata inspection.
 * @param tableNames - Existing table names whose comments are required.
 * @returns Existing comments keyed by table name.
 */
async function getMysqlTableComments(
	db: Knex,
	tableNames: string[],
): Promise<Map<string, string | null>> {
	if (tableNames.length === 0) {
		return new Map();
	}

	const rows = await db<MySqlTableCommentRow>('information_schema.TABLES')
		.select({
			tableName: 'TABLE_NAME',
			comment: 'TABLE_COMMENT',
		})
		.whereRaw('TABLE_SCHEMA = DATABASE()')
		.whereIn('TABLE_NAME', tableNames);

	return new Map(rows.flatMap(row => {
		const tableName = stringValue(row.tableName);

		if (!tableName) return [];

		return [[
			tableName,
			stringValue(row.comment),
		]];
	}));
}

/**
 * Converts database index-type metadata into a framework index kind.
 *
 * @param input - Raw index type from `SHOW INDEX`.
 * @returns Framework index type.
 */
function indexType(input: unknown): 'normal' | 'vector' {
	const value = String(input ?? '').trim().toLowerCase();

	return value === 'vector' ? 'vector' : 'normal';
}

/**
 * Encodes a numeric vector as little-endian float32 bytes.
 */
export function vectorToMysqlBuffer(vector: readonly number[]): Buffer {
	const buffer = Buffer.allocUnsafe(vector.length * VECTOR_BYTES_PER_ENTRY);

	for (let index = 0; index < vector.length; index += 1) {
		const value = vector[index];

		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Vector value at index ${index} must be a finite number.`);
		}

		buffer.writeFloatLE(value, index * VECTOR_BYTES_PER_ENTRY);
	}

	return buffer;
}

/**
 * Decodes a vector from a binary value, text JSON, or already-decoded array.
 */
export function vectorFromDbValue(input: unknown): number[] | null {
	if (input === null || input === undefined || input === '') {
		return null;
	}

	if (input instanceof Uint8Array) {
		return vectorFromMysqlBuffer(input);
	}

	if (typeof input === 'string') {
		const value = input.trim();

		if (!value) return null;

		return JSON.parse(value) as number[] | null;
	}

	return input as number[] | null;
}

/**
 * Decodes little-endian float32 vector bytes into app-memory numbers.
 */
function vectorFromMysqlBuffer(input: Buffer | Uint8Array): number[] {
	const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

	if (buffer.length % VECTOR_BYTES_PER_ENTRY !== 0) {
		throw new Error('VECTOR binary data length must be divisible by 4.');
	}

	const vector: number[] = [];

	for (
		let offset = 0;
		offset < buffer.length;
		offset += VECTOR_BYTES_PER_ENTRY
	) {
		vector.push(buffer.readFloatLE(offset));
	}

	return vector;
}

/**
 * Extracts row arrays from mysql2 raw result tuples.
 */
function extractMysqlRows(result: unknown): unknown[] {
	if (!Array.isArray(result)) return [];

	const [rows] = result;

	return Array.isArray(rows) ? rows : [];
}

/**
 * Returns a non-empty string value from database metadata.
 */
function stringValue(input: unknown): string | null {
	return typeof input === 'string' && input !== '' ? input : null;
}

/**
 * Converts MySQL index collation metadata into an order direction.
 */
function indexColumnOrder(input: unknown): 'asc' | 'desc' | undefined {
	if (typeof input !== 'string') return undefined;

	const value = input.trim().toUpperCase();

	if (value === 'A') return 'asc';
	if (value === 'D') return 'desc';

	return undefined;
}
