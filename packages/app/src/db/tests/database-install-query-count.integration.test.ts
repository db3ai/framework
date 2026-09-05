import {
	ActiveRecord,
	Database,
	type FieldBuilder,
} from '../index';
import { createGeneratedTestDatabase } from './support/db';
import { describe, expect, it } from 'vitest';

/**
 * Model used to verify efficient synchronization of an unchanged table.
 */
class EfficientSyncRecord extends ActiveRecord {
	static override table = 'efficient_sync_records';
	static override primaryKey = 'id';
	static override comment = 'Efficient model schema synchronization fixture.';

	/**
	 * Defines the fixture's database-backed fields.
	 *
	 * @param field - Field builder used to describe model storage.
	 * @returns Fixture field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
				index: true,
			}),
		};
	}
}

/**
 * Model used to verify safe changes share one captured schema snapshot.
 */
class LegacySyncRecord extends ActiveRecord {
	static override table = 'legacy_sync_records';
	static override primaryKey = 'id';

	/**
	 * Defines missing, nullable, widened, and indexed fixture fields.
	 *
	 * @param field - Field builder used to describe model storage.
	 * @returns Fixture field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			label: field.string({
				required: true,
				length: 80,
				index: true,
			}),
			notes: field.text(),
		};
	}
}

/**
 * Model used to verify post-install reporting for an unsafe nullability change.
 */
class RequiredSyncRecord extends ActiveRecord {
	static override table = 'required_sync_records';
	static override primaryKey = 'id';

	/**
	 * Defines a required field that cannot be tightened over existing null rows.
	 *
	 * @param field - Field builder used to describe model storage.
	 * @returns Fixture field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			value: field.string({
				required: true,
				length: 80,
			}),
		};
	}
}

/** Model used to verify concurrent processes can safely synchronize one index. */
class ConcurrentIndexSyncRecord extends ActiveRecord {
	static override table = 'concurrent_index_sync_records';
	static override primaryKey = 'id';

	/**
	 * Defines the indexed field shared by concurrent synchronizers.
	 *
	 * @param field - Field builder used to describe model storage.
	 * @returns Fixture field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
				index: true,
			}),
		};
	}
}

describe('Database install schema inspection', () => {
	it('accepts an index concurrently added by another schema synchronizer', async () => {
		const generated = await createGeneratedTestDatabase('concurrent_index_schema_sync');

		try {
			await generated.db.schema.createTable(ConcurrentIndexSyncRecord.table, table => {
				table.specificType('id', 'char(26)').primary().notNullable();
				table.string('name', 80).notNullable();
			});

			await Promise.all([
				new Database(generated.db).install(ConcurrentIndexSyncRecord),
				new Database(generated.db).install(ConcurrentIndexSyncRecord),
			]);

			await expect(new Database(generated.db).diff(ConcurrentIndexSyncRecord)).resolves.toEqual([]);
		} finally {
			await generated.destroy();
		}
	});

	it('inspects an unchanged model schema only once', async () => {
		const generated = await createGeneratedTestDatabase('efficient_schema_sync');
		const database = new Database(generated.db);

		try {
			await database.install({
				reportSchemaDiff: false,
			}, EfficientSyncRecord);

			let queryCount = 0;
			/**
			 * Counts SQL statements emitted during the second install pass.
			 */
			const countQuery = (): void => {
				queryCount += 1;
			};

			generated.db.on('query', countQuery);

			try {
				await database.install({
					reportSchemaDiff: false,
				}, EfficientSyncRecord);
			} finally {
				generated.db.off('query', countQuery);
			}

			expect(queryCount).toBeLessThanOrEqual(4);
		} finally {
			await generated.destroy();
		}
	});

	it('applies safe changes from one captured table schema', async () => {
		const generated = await createGeneratedTestDatabase('captured_schema_sync');
		const database = new Database(generated.db);

		try {
			await generated.db.schema.createTable(LegacySyncRecord.table, table => {
				table.specificType('id', 'char(26)').primary().notNullable();
				table.string('notes', 80).notNullable();
			});

			await database.install({
				reportSchemaDiff: false,
			}, LegacySyncRecord);

			const columnInfo = await generated.db(LegacySyncRecord.table).columnInfo();

			expect(columnInfo).toHaveProperty('label');
			expect(columnInfo.notes.type.toLowerCase()).toBe('longtext');
			expect(columnInfo.notes.nullable).toBe(true);
			await expect(database.diff(LegacySyncRecord)).resolves.toEqual([]);
		} finally {
			await generated.destroy();
		}
	});

	it('still reports differences that safe synchronization cannot apply', async () => {
		const generated = await createGeneratedTestDatabase('blocked_schema_sync');
		const reports: unknown[] = [];
		const database = new Database(generated.db);

		try {
			await generated.db.schema.createTable(RequiredSyncRecord.table, table => {
				table.specificType('id', 'char(26)').primary().notNullable();
				table.string('value', 80).nullable();
			});
			await generated.db(RequiredSyncRecord.table).insert({
				id: '01H00000000000000000000001',
				value: null,
			});

			await database.install({
				/**
				 * Captures remaining schema differences for assertion.
				 *
				 * @param differences - Differences left after safe sync.
				 */
				reportSchemaDiff(differences) {
					reports.push(differences);
				},
			}, RequiredSyncRecord);

			expect(reports).toEqual([
				expect.arrayContaining([
					expect.objectContaining({
						table: RequiredSyncRecord.table,
						differences: expect.arrayContaining([
							expect.objectContaining({
								column: 'value',
								kind: 'nullable_mismatch',
								rowsWithNull: 1,
							}),
						]),
					}),
				]),
			]);
		} finally {
			await generated.destroy();
		}
	});
});
