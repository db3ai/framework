import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActiveRecord, Database, type FieldBuilder } from '../index';
import { App } from '../../server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from './support/db';

interface ProviderCredentials {
	token: string;
	scopes: string[];
}

class EncryptedSettingsRecord extends ActiveRecord {
	static override table = 'encrypted_settings_records';
	static override primaryKey = 'id';

	/**
	 * Defines the disposable encrypted-field integration schema.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Fields used by the encrypted storage integration test.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			credentials: field.encryptedJson<ProviderCredentials>({
				selectedByDefault: false,
			}),
		};
	}

	declare id: string | null;
	declare credentials: ProviderCredentials | null;
}

describe('EncryptedJsonField database integration', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let application: App | null = null;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('encrypted_json');
		db = database.db;
		application = new App({
			db,
			config: {
				security: {
					key: '0123456789abcdef0123456789abcdef',
				},
			},
		});

		await new Database(db).install(EncryptedSettingsRecord);
	});

	beforeEach(async () => {
		await db(EncryptedSettingsRecord.table).delete();
	});

	afterAll(async () => {
		await application?.close();
		await database?.destroy();
	});

	it('stores ciphertext and decrypts only when the hidden field is selected', async () => {
		const credentials = {
			token: 'provider-secret',
			scopes: ['posts:write'],
		};
		const record = await EncryptedSettingsRecord.create({
			credentials,
		}).save();
		const rawRow = await db(EncryptedSettingsRecord.table)
			.where({ id: record.id })
			.first();
		const defaultFound = await EncryptedSettingsRecord.findByPk(record.id);
		const selectedFound = await EncryptedSettingsRecord
			.query()
			.withField('credentials')
			.wherePk(record.id)
			.first();

		expect(String(rawRow.credentials)).toMatch(/^security:1:aes-256-gcm:/);
		expect(String(rawRow.credentials)).not.toContain('provider-secret');
		expect(defaultFound?.credentials).toBeNull();
		expect(selectedFound?.credentials).toEqual(credentials);
		expect(selectedFound?.toJSON()).not.toHaveProperty('credentials');
	});
});
