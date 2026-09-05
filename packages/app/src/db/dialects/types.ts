import type { Knex } from 'knex';
import type { DatabaseColumnTypes } from './columnTypes';

export type DatabaseDialectName = 'mysql' | 'mariadb' | 'postgres';

export type DatabaseConnectionName =
	| 'mysql'
	| 'mysql2'
	| 'mariadb'
	| 'postgres'
	| 'pgsql'
	| 'pg';

export interface NormalizedIndexColumn {
	name: string;
	order?: 'asc' | 'desc';
}

export interface TableIndexSpec {
	name: string;
	columns: NormalizedIndexColumn[];
	unique: boolean;
	primary: boolean;
	type?: 'normal' | 'vector';
}

export interface DatabaseDialect {
	name: DatabaseDialectName;
	knexClient: string;
	defaultPort: number;
	supportsReturningRows: boolean;
	supportsTableComments: boolean;
	supportsVectorIndexes: boolean;
	vectorMaxDimensions: number;
	columnTypes: DatabaseColumnTypes;
	vectorColumnType(dimensions?: number): string;
	vectorToDbValue(vector: readonly number[], db?: Knex): unknown;
	vectorFromDbValue(input: unknown): number[] | null;
	createDatabase(db: Knex, databaseName: string): Promise<void>;
	dropDatabase(db: Knex, databaseName: string): Promise<void>;
	quoteIdentifier(identifier: string): string;
	getTableIndexes(db: Knex, tableName: string): Promise<TableIndexSpec[]>;
	/**
	 * Reads comments for the requested existing tables.
	 *
	 * @param db - Database connection used for metadata inspection.
	 * @param tableNames - Model table names whose comments are required.
	 * @returns Existing comments keyed by table name.
	 */
	getTableComments(
		db: Knex,
		tableNames: string[],
	): Promise<Map<string, string | null>>;
}

export interface DatabaseValueOptions {
	db?: Knex;
	dialect?: DatabaseDialect;
}
