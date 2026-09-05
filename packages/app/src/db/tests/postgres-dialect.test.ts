import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';

import {
	databaseDialectForConnection,
	mariaDbDialect,
	postgresDialect,
	rememberDatabaseDialect,
	resolveDatabaseDialect,
} from '@db3.ai/app/db';

describe('PostgreSQL database dialect', () => {
	it('describes PostgreSQL column and vector types', () => {
		expect(postgresDialect.columnTypes.varchar(120)).toBe('varchar(120)');
		expect(postgresDialect.columnTypes.longText()).toBe('text');
		expect(postgresDialect.columnTypes.json()).toBe('jsonb');
		expect(postgresDialect.columnTypes.boolean()).toBe('boolean');
		expect(postgresDialect.columnTypes.integer()).toBe('integer');
		expect(postgresDialect.columnTypes.integer({ unsigned: true })).toBe('integer');
		expect(postgresDialect.columnTypes.integer({ big: true })).toBe('bigint');
		expect(postgresDialect.columnTypes.bigIncrements()).toBe('bigserial');
		expect(postgresDialect.columnTypes.timestamp(3)).toBe('timestamp(3)');
		expect(postgresDialect.vectorColumnType()).toBe('vector');
		expect(postgresDialect.vectorColumnType(1536)).toBe('vector(1536)');
	});

	it('converts vectors through pgvector text values', () => {
		const vector = [0.25, -1, 2.5];
		const databaseValue = postgresDialect.vectorToDbValue(vector);

		expect(databaseValue).toBe('[0.25,-1,2.5]');
		expect(postgresDialect.vectorFromDbValue(databaseValue)).toEqual(vector);
		expect(postgresDialect.vectorFromDbValue(vector)).toEqual(vector);
		expect(postgresDialect.vectorFromDbValue(null)).toBeNull();
		expect(() => postgresDialect.vectorToDbValue([1, Number.NaN])).toThrow(
			'Vector value at index 1 must be a finite number.',
		);
	});

	it('quotes PostgreSQL identifiers including embedded quotes', () => {
		expect(postgresDialect.quoteIdentifier('reporting')).toBe('"reporting"');
		expect(postgresDialect.quoteIdentifier('tenant"archive')).toBe(
			'"tenant""archive"',
		);
	});

	it('resolves every supported PostgreSQL connection alias', () => {
		expect(resolveDatabaseDialect('postgres')).toBe(postgresDialect);
		expect(resolveDatabaseDialect(' PGSQL ')).toBe(postgresDialect);
		expect(resolveDatabaseDialect('pg')).toBe(postgresDialect);
		expect(() => resolveDatabaseDialect('sqlite')).toThrow(
			'Unsupported DB_CONNECTION "sqlite".',
		);
	});

	it('uses the client name or remembered connection dialect without connecting', () => {
		const postgresConnection = {
			client: {
				config: {
					client: 'pg',
				},
			},
		} as unknown as Knex;
		const rememberedConnection = {
			client: {
				config: {
					client: 'custom',
				},
			},
		} as unknown as Knex;

		expect(databaseDialectForConnection(postgresConnection)).toBe(postgresDialect);

		rememberDatabaseDialect(rememberedConnection, mariaDbDialect);

		expect(databaseDialectForConnection(rememberedConnection)).toBe(mariaDbDialect);
	});
});
