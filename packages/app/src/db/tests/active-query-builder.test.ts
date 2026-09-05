import knex, { type Knex } from 'knex';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	ActiveRecord,
	mariaDbDialect,
	mysqlDialect,
	RecordNotFoundError,
	rememberDatabaseDialect,
	type DatabaseDialect,
	type FieldBuilder,
} from '../index';

/**
 * Test model containing one native vector field and one scalar field.
 */
class VectorQueryRecord extends ActiveRecord {
	static override table = 'vector_query_records';

	/**
	 * Defines fields used by vector-query builder tests.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Field definitions for the test model.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			title: field.string(),
			embedding: field.vector({
				dimensions: 3,
				required: true,
			}),
		};
	}
}

describe('ActiveQueryBuilder vector search', () => {
	it('qualifies field-aware clauses against the model table for joined queries', async () => {
		const db = testKnex(mariaDbDialect);

		try {
			const sql = VectorQueryRecord
				.query(db)
				.where('title', 'Frog ponds')
				.whereIn('id', ['01H00000000000000000000001'])
				.whereNotNull('embedding')
				.orderBy('title', 'desc')
				.toKnex()
				.join('related_vectors as related', 'related.vector_id', 'vector_query_records.id')
				.toSQL();

			expect(sql.sql).toContain('where `vector_query_records`.`title` = ?');
			expect(sql.sql).toContain('and `vector_query_records`.`id` in (?)');
			expect(sql.sql).toContain('and `vector_query_records`.`embedding` is not null');
			expect(sql.sql).toContain('order by `vector_query_records`.`title` desc');
		} finally {
			await db.destroy();
		}
	});

	it('adds MariaDB vector distance select, filter, and ordering for vector fields', async () => {
		const db = testKnex(mariaDbDialect);

		try {
			const sql = VectorQueryRecord
				.query(db)
				.whereVectorSimilarTo('embedding', [0.1, -0.2, 0.3], {
					as: 'distance',
					maxDistance: 0.5,
				})
				.limit(5)
				.toKnex()
				.toSQL();

			expect(sql.sql).toContain('VEC_DISTANCE_COSINE(`vector_query_records`.`embedding`, VEC_FromText(?)) as distance');
			expect(sql.sql).toContain('where VEC_DISTANCE_COSINE(`vector_query_records`.`embedding`, VEC_FromText(?)) <= ?');
			expect(sql.sql).toContain('order by `distance` asc');
			expect(sql.bindings).toEqual([
				JSON.stringify([0.1, -0.2, 0.3]),
				JSON.stringify([0.1, -0.2, 0.3]),
				0.5,
				5,
			]);
		} finally {
			await db.destroy();
		}
	});

	it('rejects non-vector fields for vector similarity queries', async () => {
		const db = testKnex(mariaDbDialect);

		try {
			expect(() => {
				VectorQueryRecord
					.query(db)
					.whereVectorSimilarTo('title', [0.1, -0.2, 0.3]);
			}).toThrow('Field "title" is not a vector field.');
		} finally {
			await db.destroy();
		}
	});

	it('reports unsupported vector similarity dialects before building SQL', async () => {
		const db = testKnex(mysqlDialect);
		const query = VectorQueryRecord.query(db);

		try {
			expect(query.supportsVectorSimilaritySearch()).toBe(false);
			expect(query.vectorSimilarityUnsupportedMessage()).toContain('mysql');
			expect(() => {
				query.whereVectorSimilarTo('embedding', [0.1, -0.2, 0.3]);
			}).toThrow('mysql');
		} finally {
			await db.destroy();
		}
	});
});

describe('ActiveQueryBuilder firstOrFail', () => {
	it('returns the first hydrated record when a row exists', async () => {
		const db = executableTestKnex({
			id: '01H00000000000000000000001',
			title: 'First result',
			embedding: JSON.stringify([0.1, -0.2, 0.3]),
		});

		const record = await VectorQueryRecord
			.query(db)
			.firstOrFail();

		expect(record).toBeInstanceOf(VectorQueryRecord);
		expect(record.get('id')).toBe('01H00000000000000000000001');
		expect(record.get('title')).toBe('First result');
	});

	it('throws a record-not-found error when no row exists', async () => {
		const db = executableTestKnex(null);

		await expect(
			VectorQueryRecord
				.query(db)
				.firstOrFail(),
		).rejects.toThrow(RecordNotFoundError);
		await expect(
			VectorQueryRecord
				.query(db)
				.firstOrFail(),
		).rejects.toThrow('The requested vector query record could not be found.');
	});
});

describe('ActiveQueryBuilder bounded reads', () => {
	it('selects only requested logical model fields', async () => {
		const db = testKnex(mariaDbDialect);

		try {
			const sql = VectorQueryRecord
				.query(db)
				.select('id', 'title')
				.toKnex()
				.toSQL();

			expect(sql.sql).toContain('select `vector_query_records`.`id`, `vector_query_records`.`title`');
			expect(sql.sql).not.toContain('`vector_query_records`.`embedding`');
		} finally {
			await db.destroy();
		}
	});

	it('counts records without hydrating model rows', async () => {
		const { db, query } = aggregateTestKnex('12');

		await expect(VectorQueryRecord.query(db).count()).resolves.toBe(12);
		expect(query.count).toHaveBeenCalledWith({
			recordCount: '*',
		});
		expect(query.select).not.toHaveBeenCalled();
	});
});

/**
 * Creates an offline Knex query compiler with an explicit framework dialect.
 *
 * @param dialect - Dialect remembered for the fake query connection.
 * @returns Knex connection used only for SQL generation.
 */
function testKnex(dialect: DatabaseDialect): Knex {
	const db = knex({
		client: dialect.knexClient,
	});

	rememberDatabaseDialect(db, dialect);

	return db;
}

/**
 * Creates a tiny executable Knex stand-in for query hydration tests.
 *
 * @param row - Row returned by the fake query builder's `first()` call.
 * @returns Knex-like function that returns the fake query builder.
 */
function executableTestKnex(row: Record<string, unknown> | null): Knex {
	const query = {
		clone: vi.fn(() => query),
		select: vi.fn(() => query),
		first: vi.fn(async () => row),
	};

	return vi.fn(() => query) as unknown as Knex;
}

/**
 * Creates a tiny executable Knex stand-in for aggregate query tests.
 *
 * @param count - Driver-shaped count returned by the fake query.
 * @returns Knex-like connection and observable query methods.
 */
function aggregateTestKnex(count: unknown): {
	db: Knex;
	query: {
		clone: ReturnType<typeof vi.fn>;
		count: ReturnType<typeof vi.fn>;
		first: ReturnType<typeof vi.fn>;
		select: ReturnType<typeof vi.fn>;
	};
} {
	const query = {
		clone: vi.fn(),
		count: vi.fn(),
		first: vi.fn(async () => ({
			recordCount: count,
		})),
		select: vi.fn(),
	};

	query.clone.mockReturnValue(query);
	query.count.mockReturnValue(query);
	query.select.mockReturnValue(query);

	return {
		db: vi.fn(() => query) as unknown as Knex,
		query,
	};
}
