import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActiveRecord, type FieldBuilder } from '../../db';
import type { Serializable } from '..';
import { SerializationError, SerializationRegistryError, Serializer } from '..';
import { App } from '../../server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/tests/support/db';

/**
 * ActiveRecord fixture used for identity and dirty-state serialization tests.
 */
class SerializerRecord extends ActiveRecord {
	static override table = 'serializer_records';
	static override primaryKey = 'key';
	static override returning = false;

	/**
	 * Defines the model used for serializer identity round trips.
	 *
	 * @param field - Framework field builder.
	 * @returns Serializer record fields.
	 */
	static override fields(field: FieldBuilder) {
		return {
			key: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
			}),
			metadata: field.jsonText<{
				tags: string[];
			}>(),
			observedAt: field.timestamp({
				column: 'observed_at',
			}),
		};
	}

	declare key: string | null;
	declare name: string | null;
	declare metadata: {
		tags: string[];
	} | null;
	declare observedAt: Date | null;
}

/**
 * Soft-deletable fixture used for serializer lifecycle tests.
 */
class SoftSerializerRecord extends ActiveRecord {
	static override table = 'soft_serializer_records';
	static override primaryKey = 'key';
	static override returning = false;
	static override softDeletes = true;

	/**
	 * Defines the soft-deletable model used by serializer rejection tests.
	 *
	 * @param field - Framework field builder.
	 * @returns Soft serializer record fields.
	 */
	static override fields(field: FieldBuilder) {
		return {
			key: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
			deletedAt: field.timestamp({
				column: 'deleted_at',
				index: true,
			}),
		};
	}

	declare key: string | null;
	declare name: string | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
	declare deletedAt: Date | null;
}

/**
 * Registered fixture whose table is intentionally absent for restore failures.
 */
class MissingTableSerializerRecord extends ActiveRecord {
	static override table = 'missing_serializer_records';
	static override primaryKey = 'key';
	static override returning = false;

	/**
	 * Defines the minimum model shape needed to perform a failing lookup.
	 *
	 * @param field - Framework field builder.
	 * @returns Missing-table record fields.
	 */
	static override fields(field: FieldBuilder) {
		return {
			key: field.ulid(),
		};
	}

	declare key: string | null;
}

interface RecordContainerState {
	record: ActiveRecord;
	nested?: ActiveRecord[];
}

/**
 * Registered root fixture whose constructor receives restored model instances.
 */
class RecordContainer implements Serializable<RecordContainerState> {
	/**
	 * Creates one record-backed serializable value.
	 *
	 * @param state - Complete constructor state.
	 */
	constructor(readonly state: RecordContainerState) {}

	/**
	 * Returns the complete constructor state.
	 *
	 * @returns State containing registered ActiveRecord references.
	 */
	toJSON(): RecordContainerState {
		return this.state;
	}
}

describe('ActiveRecord Serializer integration', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let application: App | null = null;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('serializer');
		db = database.db;
		application = new App({
			db,
			serializer: {
				classes: {
					'serializer.container': RecordContainer,
				},
				models: {
					'serializer.record': SerializerRecord,
					'serializer.soft-record': SoftSerializerRecord,
				},
			},
		});

		await application.db.install(
			SerializerRecord,
			SoftSerializerRecord,
		);
	});

	beforeEach(async () => {
		await db(SoftSerializerRecord.table).delete();
		await db(SerializerRecord.table).delete();
	});

	afterAll(async () => {
		await application?.close();
		await database?.destroy();
	});

	it('restores registered records through the root constructor using current database values', async () => {
		const record = await saveSerializerRecord('Before serialization');
		const payload = requireApplication().serializer.serialize(new RecordContainer({
			record,
			nested: [
				record,
			],
		}));
		const durableJson = JSON.stringify(payload);

		expect(payload).toEqual(expect.objectContaining({
			state: {
				record: {
					$platform: 'active-record',
					model: 'serializer.record',
					id: record.key,
				},
				nested: [
					{
						$platform: 'active-record',
						model: 'serializer.record',
						id: record.key,
					},
				],
			},
		}));
		expect(durableJson).not.toContain('Before serialization');

		await db(SerializerRecord.table)
			.where({
				key: record.key,
			})
			.update({
				name: 'After serialization',
			});

		const restored = await requireApplication().serializer.deserialize<RecordContainer>(
			JSON.parse(durableJson),
		);
		const restoredRecord = restored.state.record as SerializerRecord;

		expect(restored).toBeInstanceOf(RecordContainer);
		expect(restoredRecord).toBeInstanceOf(SerializerRecord);
		expect(restoredRecord.key).toBe(record.key);
		expect(restoredRecord.name).toBe('After serialization');
		expect(restored.state.nested?.[0]).toBe(restoredRecord);
	});

	it('rejects unsaved, dirty, primary-key-less, and unregistered records', async () => {
		const unsaved = new SerializerRecord({
			name: 'Unsaved',
		});
		const dirty = await saveSerializerRecord('Dirty');
		const mutated = await saveSerializerRecord('Mutated');
		const missingKey = SerializerRecord.fromDb({
			name: 'Missing key',
		}, db);
		const unregistered = await saveSerializerRecord('Unregistered');

		dirty.name = 'Unsaved change';
		mutated.metadata?.tags.push('in-place change');

		expectSerializationFailure(
			() => serializeRecord(unsaved),
			{
				code: 'unsaved_active_record',
				path: '$.state.record',
			},
		);
		expectSerializationFailure(
			() => serializeRecord(dirty),
			{
				code: 'dirty_active_record',
				path: '$.state.record',
			},
		);
		expectSerializationFailure(
			() => serializeRecord(mutated),
			{
				code: 'dirty_active_record',
				path: '$.state.record',
			},
		);
		expectSerializationFailure(
			() => serializeRecord(missingKey),
			{
				code: 'invalid_value',
				path: '$.state.record.id',
			},
		);
		expectSerializationFailure(
			() => new Serializer({
				classes: {
					'serializer.container': RecordContainer,
				},
			}).serialize(new RecordContainer({
				record: unregistered,
			})),
			{
				code: 'unregistered_model',
				path: '$.state.record',
			},
		);
	});

	it('rejects already soft-deleted records and conflicting model names', async () => {
		const softDeleted = new SoftSerializerRecord({
			name: 'Soft deleted',
		});

		await softDeleted.save();
		await softDeleted.delete();

		expect(() => requireApplication().serializer.registry.registerModel(
			'serializer.record',
			SoftSerializerRecord,
		)).toThrow(SerializationRegistryError);
		expectSerializationFailure(
			() => serializeRecord(softDeleted),
			{
				code: 'trashed_active_record',
				path: '$.state.record',
			},
		);
	});

	it('distinguishes missing rows from database restore failures', async () => {
		const record = await saveSerializerRecord('Delete after serialization');
		const payload = requireApplication().serializer.serialize(new RecordContainer({
			record,
		}));

		await db(SerializerRecord.table)
			.where({
				key: record.key,
			})
			.delete();

		await expect(
			requireApplication().serializer.deserialize(
				JSON.parse(JSON.stringify(payload)),
			),
		).rejects.toMatchObject({
			code: 'active_record_not_found',
			path: '$.state.record',
			cause: expect.any(Error),
		});

		requireApplication().serializer.registry.registerModel(
			'serializer.missing-record',
			MissingTableSerializerRecord,
		);

		await expect(requireApplication().serializer.deserialize({
			format: 'platform.serialized-object',
			version: 1,
			name: 'serializer.container',
			state: {
				record: {
					$platform: 'active-record',
					model: 'serializer.missing-record',
					id: '01J00000000000000000000000',
				},
			},
		})).rejects.toMatchObject({
			code: 'active_record_restore_failed',
			path: '$.state.record',
			cause: expect.any(Error),
		});
	});

	it('treats a row soft-deleted after serialization as missing', async () => {
		const record = new SoftSerializerRecord({
			name: 'Delete after serialization',
		});

		await record.save();

		const payload = requireApplication().serializer.serialize(new RecordContainer({
			record,
		}));

		await record.delete();

		await expect(
			requireApplication().serializer.deserialize(
				JSON.parse(JSON.stringify(payload)),
			),
		).rejects.toMatchObject({
			code: 'active_record_not_found',
			path: '$.state.record',
		});
	});

	/**
	 * Returns the initialized application for one integration test.
	 *
	 * @returns Active test application.
	 */
	function requireApplication(): App {
		if (!application) {
			throw new Error('Serializer integration application is not initialized.');
		}

		return application;
	}

	/**
	 * Serializes one record through the registered root fixture.
	 *
	 * @param record - Record to include in constructor state.
	 * @returns Versioned serializer payload.
	 */
	function serializeRecord(record: ActiveRecord) {
		return requireApplication().serializer.serialize(new RecordContainer({
			record,
		}));
	}

	/**
	 * Saves one clean serializer record.
	 *
	 * @param name - Record name to persist.
	 * @returns Saved clean record.
	 */
	async function saveSerializerRecord(name: string): Promise<SerializerRecord> {
		const record = new SerializerRecord({
			name,
			metadata: {
				tags: [
					'initial',
				],
			},
			observedAt: new Date('2026-07-29T12:00:00.000Z'),
		});

		await record.save();

		return record;
	}
});

/**
 * Asserts ActiveRecord serialization fails with structured details.
 *
 * @param callback - Serializer operation expected to throw.
 * @param expected - Error code and path expected from the failure.
 */
function expectSerializationFailure(
	callback: () => unknown,
	expected: Pick<SerializationError, 'code' | 'path'>,
): void {
	try {
		callback();
		throw new Error('Expected ActiveRecord serialization to fail.');
	} catch (error) {
		expect(error).toBeInstanceOf(SerializationError);
		expect(error).toMatchObject(expected);
	}
}
