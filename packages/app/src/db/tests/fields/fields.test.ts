import { Buffer } from 'node:buffer';
import knex from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPasswordHash } from '@db3.ai/app/auth/password-hash';
import { isUlid, ulid } from '@db3.ai/pure/ulid';
import { App, clearActiveApp } from '../../../server';
import {
	mariaDbDialect,
	mysqlDialect,
	postgresDialect,
	type FieldContext,
	type ModelMetadata,
} from '../../index';
import {
	BigIncrementsField,
	BooleanField,
	CharUuidField,
	ChoiceStringField,
	DecimalField,
	EmailField,
	EncryptedJsonField,
	EncryptedJsonFieldError,
	IntegerField,
	JsonField,
	JsonStringField,
	PasswordField,
	StringListField,
	StringField,
	TextField,
	TimestampField,
	UlidField,
	UrlField,
	VectorField,
} from '../../fields';

const model: ModelMetadata = {
	table: 'field_tests',
	primaryKey: 'id',
	fields: () => ({}),
};

afterEach(() => {
	clearActiveApp();
});

function ctx(fieldName = 'value'): FieldContext {
	return {
		model,
		fieldName,
	};
}

describe('field interfaces', () => {
	it('stores effective config defaults on field instances', () => {
		const email = new EmailField();
		const uuid = new CharUuidField();
		const list = new StringListField();
		const password = new PasswordField({ minLength: 12 });
		const timestamp = new TimestampField();

		expect(email.config).toMatchObject({
			length: 255,
			maxLength: 255,
		});
		expect(uuid.config).toMatchObject({
			length: 36,
			maxLength: 36,
			trim: true,
		});
		expect(list.getJsonValue(list.createState(ctx('items')), ctx('items'))).toEqual([]);
		expect(password.config.hidden).toBe(true);
		expect(timestamp.config.precision).toBe(0);
		expect(timestamp.getDbSchema(ctx('createdAt')).columns).toEqual([
			expect.objectContaining({
				type: 'timestamp',
			}),
		]);
	});

	it('coerces strings, validates length, and describes schema', async () => {
		const field = new StringField({
			column: 'title_column',
			required: true,
			maxLength: 3,
			default: 'untitled',
		});
		const state = field.createState(ctx('title'));

		field.setValue(state, '  test  ', ctx('title'));

		expect(field.getValue(state, ctx('title'))).toBe('test');
		expect(await field.validate(state, ctx('title'))).toEqual([
			expect.objectContaining({
				field: 'title',
				code: 'maxLength',
			}),
		]);
		expect(field.getDbSchema(ctx('title')).columns).toEqual([
			expect.objectContaining({
				name: 'title_column',
				type: 'varchar(3)',
				nullable: false,
				default: 'untitled',
			}),
		]);

		const optional = new StringField({
			default: '',
		});
		const optionalState = optional.createState(ctx('description'));

		optional.setValue(optionalState, null, ctx('description'));

		expect(optional.getValue(optionalState, ctx('description'))).toBeNull();
		expect(optional.getJsonValue(optionalState, ctx('description'))).toBe('');
	});

	it('uses varchar length as the default string validation cap', async () => {
		const defaultField = new StringField();
		const defaultState = defaultField.createState(ctx('keyword'));

		defaultField.setValue(defaultState, 'x'.repeat(256), ctx('keyword'));

		expect(defaultField.getValidationRules(ctx('keyword'))).toEqual([
			'nullable',
			'string',
			{
				rule: 'maxLength',
				value: 255,
			},
		]);
		await expect(defaultField.validate(defaultState, ctx('keyword'))).resolves.toEqual([
			expect.objectContaining({
				code: 'maxLength',
				details: {
					maxLength: 255,
				},
			}),
		]);

		const shortField = new StringField({
			length: 10,
		});
		const shortState = shortField.createState(ctx('slug'));

		shortField.setValue(shortState, 'x'.repeat(11), ctx('slug'));

		expect(shortField.getValidationRules(ctx('slug'))).toEqual([
			'nullable',
			'string',
			{
				rule: 'maxLength',
				value: 10,
			},
		]);
		await expect(shortField.validate(shortState, ctx('slug'))).resolves.toEqual([
			expect.objectContaining({
				code: 'maxLength',
				details: {
					maxLength: 10,
				},
			}),
		]);
	});

	it('does not add a default max length for text fields', () => {
		const textField = new TextField();
		const longTextField = new TextField();

		expect(textField.getValidationRules(ctx('notes'))).toEqual([
			'nullable',
			'string',
		]);
		expect(longTextField.getValidationRules(ctx('body'))).toEqual([
			'nullable',
			'string',
		]);
	});

	it('validates an explicit max length on text fields', async () => {
		const field = new TextField({
			maxLength: 5,
		});
		const state = field.createState(ctx('description'));

		field.setValue(state, '123456', ctx('description'));

		expect(field.getValidationRules(ctx('description'))).toEqual([
			'nullable',
			'string',
			{
				rule: 'maxLength',
				value: 5,
			},
		]);
		await expect(field.validate(state, ctx('description'))).resolves.toEqual([
			expect.objectContaining({
				code: 'maxLength',
				details: {
					maxLength: 5,
				},
			}),
		]);
	});

	it('normalizes email query values', () => {
		const field = new EmailField();
		const state = field.createState(ctx('email'));

		field.setValue(state, '  STEVE@EXAMPLE.COM  ', ctx('email'));

		expect(field.getValue(state, ctx('email'))).toBe('steve@example.com');
		expect(field.getQueryValue('ADMIN@EXAMPLE.COM', ctx('email'))).toBe(
			'admin@example.com',
		);
	});

	it('coerces boolean form values', () => {
		const field = new BooleanField();
		const state = field.createState(ctx('enabled'));

		field.setValue(state, 'on', ctx('enabled'));
		expect(field.getValue(state, ctx('enabled'))).toBe(true);

		field.setValue(state, '0', ctx('enabled'));
		expect(field.getValue(state, ctx('enabled'))).toBe(false);

		field.setValue(state, 'maybe', ctx('enabled'));
		expect(field.getValue(state, ctx('enabled'))).toBeNull();
	});

	it('uses dialect-safe boolean schema defaults', () => {
		const enabled = new BooleanField({ default: true });
		const disabled = new BooleanField({ default: false });

		expect(enabled.getDbSchema({
			...ctx('enabled'),
			dialect: mariaDbDialect,
		}).columns).toEqual([
			expect.objectContaining({ default: 1 }),
		]);
		expect(disabled.getDbSchema({
			...ctx('disabled'),
			dialect: mysqlDialect,
		}).columns).toEqual([
			expect.objectContaining({ default: 0 }),
		]);
		expect(enabled.getDbSchema({
			...ctx('enabled'),
			dialect: postgresDialect,
		}).columns).toEqual([
			expect.objectContaining({ default: true }),
		]);
	});

	it('serializes JSON strings for text-backed storage', async () => {
		const field = new JsonStringField<{ count: number }>({
			column: 'payload_json',
			dbType: 'longtext',
		});
		const state = field.createState(ctx('payload'));

		field.setValue(state, '{"count":2}', ctx('payload'));

		expect(field.getValue(state, ctx('payload'))).toEqual({ count: 2 });
		await expect(
			field.getDataForDb(state, ctx('payload'), {
				isInsert: true,
				onlyDirty: false,
			}),
		).resolves.toEqual({
			payload_json: '{"count":2}',
		});
		expect(() => field.setValue(state, '{invalid', ctx('payload'))).toThrow(
			SyntaxError,
		);
		expect(field.getDbSchema(ctx('payload')).columns).toEqual([
			expect.objectContaining({
				name: 'payload_json',
				type: 'longtext',
			}),
		]);
	});

	it('serializes permissive JSON values and describes JSON schema', async () => {
		const field = new JsonField<Record<string, unknown> | null>({
			column: 'payload_json',
			index: true,
			indexName: 'field_tests_payload_index',
		});
		const state = field.createState(ctx('payload'));

		field.setValue(state, {
			embedding: [0.1, -0.2, 0.3],
		}, ctx('payload'));

		expect(field.getValue(state, ctx('payload'))).toEqual({
			embedding: [0.1, -0.2, 0.3],
		});
		await expect(field.getDataForDb(state, ctx('payload'), {
			isInsert: true,
			onlyDirty: false,
		})).resolves.toEqual({
			payload_json: '{"embedding":[0.1,-0.2,0.3]}',
		});

		const hydratedState = field.createState(ctx('payload'));

		field.setFromDb(hydratedState, {
			payload_json: '{"embedding":[0.4,0.5]}',
		}, ctx('payload'));

		expect(field.getValue(hydratedState, ctx('payload'))).toEqual({
			embedding: [0.4, 0.5],
		});
		expect(field.getDbSchema(ctx('payload')).columns).toEqual([
			expect.objectContaining({
				name: 'payload_json',
				type: 'json',
			}),
		]);
		expect(field.getDbSchema(ctx('payload')).indexes).toEqual([
			{
				columns: ['payload_json'],
				name: 'field_tests_payload_index',
			},
		]);
	});

	it('normalizes URL input values', () => {
		const field = new UrlField();
		const state = field.createState(ctx('url'));

		field.setValue(state, ' example.com ', ctx('url'));
		expect(field.getValue(state, ctx('url'))).toBe('https://example.com/');

		field.setValue(state, 'localhost', ctx('url'));
		expect(field.getValue(state, ctx('url'))).toBeNull();
	});

	it('normalizes capped string list input values and serializes JSON', async () => {
		const field = new StringListField({
			column: 'items',
			maxItems: 3,
		});
		const state = field.createState(ctx('items'));

		field.setValue(state, [
			' Founders ',
			'Marketing   Teams',
			'founders',
			'',
			'Agencies',
			'Extra',
		], ctx('items'));

		expect(field.getValue(state, ctx('items'))).toEqual([
			'Founders',
			'Marketing Teams',
			'Agencies',
		]);
		await expect(field.getDataForDb(state, ctx('items'), {
			isInsert: true,
			onlyDirty: false,
		})).resolves.toEqual({
			items: '["Founders","Marketing Teams","Agencies"]',
		});
		expect(field.getValidationRules(ctx('items'))).toEqual([
			'nullable',
			'array',
			{
				rule: 'max',
				value: 3,
			},
		]);
	});

	it('normalizes string list input values without a default item cap', async () => {
		const field = new StringListField({
			column: 'items',
		});
		const state = field.createState(ctx('items'));
		const items = [
			'Founders',
			'Marketing Teams',
			'Agencies',
			'Consultants',
			'Publishers',
			'Retailers',
			'SaaS Teams',
			'Creators',
			'Developers',
		];

		field.setValue(state, items, ctx('items'));

		expect(field.getValue(state, ctx('items'))).toEqual(items);
		await expect(field.getDataForDb(state, ctx('items'), {
			isInsert: true,
			onlyDirty: false,
		})).resolves.toEqual({
			items: JSON.stringify(items),
		});
		expect(field.getValidationRules(ctx('items'))).toEqual([
			'nullable',
			'array',
		]);
		await expect(field.validate(state, ctx('items'))).resolves.toEqual([]);
	});

	it('validates native MySQL embedding vectors', async () => {
		const field = new VectorField({
			column: 'embedding',
			dimensions: 3,
		});
		const state = field.createState(ctx('embedding'));

		field.setValue(state, '[0.1,-0.2,0.3]', ctx('embedding'));

		expect(field.config.selectedByDefault).toBe(false);
		expect(field.config.index).toBe(false);
		expect(field.getValue(state, ctx('embedding'))).toEqual([0.1, -0.2, 0.3]);
		expect(await field.validate(state, ctx('embedding'))).toEqual([]);
		const data = await field.getDataForDb(state, ctx('embedding'), {
			isInsert: true,
			onlyDirty: false,
			valueOptions: {
				dialect: mysqlDialect,
			},
		});
		const dbValue = data.embedding;

		expect(Buffer.isBuffer(dbValue)).toBe(true);
		expect((dbValue as Buffer).toString('hex')).toBe('cdcccc3dcdcc4cbe9a99993e');

		const hydratedState = field.createState(ctx('embedding'));

		field.setFromDb(hydratedState, {
			embedding: dbValue,
		}, ctx('embedding'));

		const hydratedValue = field.getValue(hydratedState, ctx('embedding'));

		expect(hydratedValue).toHaveLength(3);
		expect(hydratedValue?.[0]).toBeCloseTo(0.1, 5);
		expect(hydratedValue?.[1]).toBeCloseTo(-0.2, 5);
		expect(hydratedValue?.[2]).toBeCloseTo(0.3, 5);
		expect(field.getValidationRules(ctx('embedding'))).toEqual([
			'nullable',
			'array',
		]);
		expect(field.getDbSchema(ctx('embedding')).columns).toEqual([
			expect.objectContaining({
				name: 'embedding',
				type: 'vector(3)',
			}),
		]);
		expect(field.getDbSchema({
			...ctx('embedding'),
			dialect: mariaDbDialect,
		}).indexes).toBeUndefined();
		expect(field.getDbSchema({
			...ctx('embedding'),
			dialect: mysqlDialect,
		}).indexes).toBeUndefined();
		expect(new VectorField({
			column: 'embedding',
			dimensions: 3,
			required: true,
		}).getDbSchema({
			...ctx('embedding'),
			dialect: mariaDbDialect,
		}).indexes).toEqual([
			{
				type: 'vector',
				columns: ['embedding'],
				name: undefined,
			},
		]);
		expect(new VectorField({
			column: 'embedding',
			dimensions: 3,
			index: false,
		}).getDbSchema({
			...ctx('embedding'),
			dialect: mariaDbDialect,
		}).indexes).toBeUndefined();
		expect(new VectorField({
			column: 'embedding',
			dimensions: 3,
			required: true,
			indexName: 'embedding_vector_index',
		}).getDbSchema({
			...ctx('embedding'),
			dialect: mariaDbDialect,
		}).indexes).toEqual([
			{
				type: 'vector',
				columns: ['embedding'],
				name: 'embedding_vector_index',
			},
		]);
		expect(() => new VectorField({
			dimensions: 0,
		})).toThrow('VectorField dimensions must be an integer between 1 and 16383.');
		expect(() => new VectorField({
			primary: true,
		})).toThrow('VECTOR columns cannot be primary, unique, or custom normal indexed keys.');
		expect(() => new VectorField({
			indexes: [{ columns: ['embedding'] }],
		})).toThrow('VECTOR columns cannot be primary, unique, or custom normal indexed keys.');
		expect(() => new VectorField({
			index: true,
		})).toThrow('VECTOR indexes require required: true because MariaDB vector indexes cannot include nullable columns.');

		field.setValue(state, [0.1, 'nope'], ctx('embedding'));

		expect(await field.validate(state, ctx('embedding'))).toEqual([
			expect.objectContaining({
				field: 'embedding',
				code: 'numberArray',
			}),
			expect.objectContaining({
				field: 'embedding',
				code: 'dimensions',
			}),
		]);
	});

	it('serializes MariaDB embedding vectors through VEC_FromText', async () => {
		const db = knex({ client: 'mysql2' });
		const field = new VectorField({
			column: 'embedding',
			dimensions: 3,
		});
		const state = field.createState(ctx('embedding'));

		try {
			field.setValue(state, [0.1, -0.2, 0.3], ctx('embedding'));

			const data = await field.getDataForDb(state, ctx('embedding'), {
				isInsert: true,
				onlyDirty: false,
				valueOptions: {
					db,
					dialect: mariaDbDialect,
				},
			});
			const sql = (data.embedding as { toSQL(): { sql: string; bindings: unknown[] } }).toSQL();

			expect(sql.sql).toBe('VEC_FromText(?)');
			expect(sql.bindings).toEqual(['[0.1,-0.2,0.3]']);
		} finally {
			await db.destroy();
		}
	});

	it('normalizes choice string values with a default fallback and index', () => {
		const field = new ChoiceStringField({
			choices: ['draft', 'published'],
			default: 'draft',
			index: true,
			indexName: 'field_tests_state_index',
		});
		const state = field.createState(ctx('state'));

		field.setValue(state, 'published', ctx('state'));
		expect(field.getValue(state, ctx('state'))).toBe('published');

		field.setValue(state, 'unknown', ctx('state'));
		expect(field.getValue(state, ctx('state'))).toBe('draft');
		expect(field.getDbSchema(ctx('state')).indexes).toEqual([
			{
				columns: ['state'],
				name: 'field_tests_state_index',
			},
		]);
	});

	it('supports schema options on standard integer fields', () => {
		const field = new IntegerField({
			unsigned: true,
			big: true,
			index: true,
			default: 0,
		});

		expect(field.getDbSchema(ctx('count'))).toEqual({
			columns: [
				expect.objectContaining({
					name: 'count',
					type: 'bigint unsigned',
					default: 0,
				}),
			],
			indexes: [
				{
					columns: ['count'],
					name: undefined,
				},
			],
		});
	});

	it('supports decimal and big increments in the standard fields set', () => {
		const decimal = new DecimalField({
			precision: 5,
			scale: 2,
			index: true,
		});
		const id = new BigIncrementsField();

		expect(decimal.getDbSchema(ctx('price'))).toEqual({
			columns: [
				expect.objectContaining({
					name: 'price',
					type: 'decimal(5,2)',
				}),
			],
			indexes: [
				{
					columns: ['price'],
					name: undefined,
				},
			],
		});
		expect(id.getDbSchema(ctx('id')).columns).toEqual([
			expect.objectContaining({
				name: 'id',
				type: 'bigint unsigned auto_increment',
				primary: true,
			}),
		]);
	});

	it('supports schema options on long text fields', () => {
		const field = new TextField({
			index: true,
			indexName: 'field_tests_notes_index',
		});

		expect(field.getDbSchema(ctx('notes'))).toEqual({
			columns: [
				expect.objectContaining({
					name: 'notes',
					type: 'longtext',
				}),
			],
			indexes: [
				{
					columns: ['notes'],
					name: 'field_tests_notes_index',
				},
			],
		});
	});

	it('encrypts JSON with authenticated randomized ciphertext and hides display values', async () => {
		new App({
			config: {
				security: {
					key: '0123456789abcdef0123456789abcdef',
				},
			},
		});
		const field = new EncryptedJsonField<{
			token: string;
			scopes: string[];
		}>({
			column: 'credentials_encrypted',
		});
		const state = field.createState(ctx('credentials'));
		const credentials = {
			token: 'secret-provider-token',
			scopes: ['posts:write'],
		};

		field.setValue(state, credentials, ctx('credentials'));

		const firstRow = await field.getDataForDb(state, ctx('credentials'), {
			isInsert: true,
			onlyDirty: false,
		});
		const secondRow = await field.getDataForDb(state, ctx('credentials'), {
			isInsert: true,
			onlyDirty: false,
		});
		const firstCiphertext = String(firstRow.credentials_encrypted);
		const secondCiphertext = String(secondRow.credentials_encrypted);
		const hydratedState = field.createState(ctx('credentials'));

		expect(firstCiphertext).toMatch(/^security:1:aes-256-gcm:/);
		expect(firstCiphertext).not.toContain(credentials.token);
		expect(secondCiphertext).not.toBe(firstCiphertext);

		field.setFromDb(hydratedState, {
			credentials_encrypted: firstCiphertext,
		}, ctx('credentials'));

		expect(field.getValue(hydratedState, ctx('credentials'))).toEqual(credentials);
		expect(field.getJsonValue(hydratedState, ctx('credentials'))).toBeUndefined();
		expect(field.config.hidden).toBe(true);
		expect(field.getDbSchema(ctx('credentials')).columns).toEqual([
			expect.objectContaining({
				name: 'credentials_encrypted',
				type: 'longtext',
				nullable: true,
			}),
		]);
		expect(() => field.getQueryValue()).toThrow(
			'Encrypted JSON fields cannot be queried directly',
		);
	});

	it('rejects encrypted JSON when the key or authenticated field context is wrong', async () => {
		new App({
			config: {
				security: {
					key: '0123456789abcdef0123456789abcdef',
				},
			},
		});
		const field = new EncryptedJsonField<{ token: string }>({
			column: 'credentials_encrypted',
		});
		const state = field.createState(ctx('credentials'));

		field.setValue(state, {
			token: 'secret-provider-token',
		}, ctx('credentials'));

		const row = await field.getDataForDb(state, ctx('credentials'), {
			isInsert: true,
			onlyDirty: false,
		});
		new App({
			config: {
				security: {
					key: 'fedcba9876543210fedcba9876543210',
				},
			},
		});
		const wrongKeyField = new EncryptedJsonField<{ token: string }>({
			column: 'credentials_encrypted',
		});
		const wrongContextField = new EncryptedJsonField<{ token: string }>({
			column: 'different_credentials',
		});

		expect(() => wrongKeyField.setFromDb(
			wrongKeyField.createState(ctx('credentials')),
			row,
			ctx('credentials'),
		)).toThrow(EncryptedJsonFieldError);

		new App({
			config: {
				security: {
					key: '0123456789abcdef0123456789abcdef',
				},
			},
		});

		expect(() => wrongContextField.setFromDb(
			wrongContextField.createState(ctx('differentCredentials')),
			{
				different_credentials: row.credentials_encrypted,
			},
			ctx('differentCredentials'),
		)).toThrow(EncryptedJsonFieldError);
	});

	it('requires exactly 32 bytes of key material for encrypted JSON', () => {
		expect(() => new App({
			config: {
				security: {
					key: 'too-short',
				},
			},
		})).toThrow('Application security key must contain exactly 32 bytes');
	});

	it('exposes ULID generation and validation through the pure package', () => {
		const id = ulid(0);

		expect(id).toHaveLength(26);
		expect(id.startsWith('0000000000')).toBe(true);
		expect(isUlid(id)).toBe(true);
		expect(isUlid('not-a-ulid')).toBe(false);
	});

	it('validates UUID and ULID field formats', async () => {
		const uuid = new CharUuidField();
		const uuidState = uuid.createState(ctx('uuid'));
		const ulid = new UlidField({ generated: true });
		const ulidState = ulid.createState(ctx('ulid'));

		uuid.setValue(uuidState, 'not-a-uuid', ctx('uuid'));
		expect(await uuid.validate(uuidState, ctx('uuid'))).toEqual([
			expect.objectContaining({ field: 'uuid', code: 'uuid' }),
		]);

		expect(ulid.getValue(ulidState, ctx('ulid'))).toMatch(
			/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
		);

		ulid.setValue(ulidState, 'not-a-ulid', ctx('ulid'));
		expect(await ulid.validate(ulidState, ctx('ulid'))).toEqual([
			expect.objectContaining({ field: 'ulid', code: 'ulid' }),
		]);
	});

	it('generates auto timestamps and serializes dates for JSON', async () => {
		const field = new TimestampField({
			column: 'updated_at',
			auto: 'both',
		});
		const state = field.createState(ctx('updatedAt'));

		const row = await field.getDataForDb(state, ctx('updatedAt'), {
			isInsert: false,
			onlyDirty: true,
		});

		expect(row.updated_at).toBeInstanceOf(Date);
		expect(field.getJsonValue(state, ctx('updatedAt'))).toEqual(
			expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		);
	});

	it('keeps passwords hidden while hashing pending plaintext', async () => {
		const field = new PasswordField({
			column: 'password_hash',
			required: true,
			minLength: 12,
		});
		const state = field.createState();

		field.setValue(state, 'correct horse battery', ctx('password'));

		expect(field.getValue()).toBeNull();
		expect(field.getJsonValue(state)).toBeUndefined();
		expect(await field.validate(state, ctx('password'))).toEqual([]);
		const row = await field.getDataForDb(state, ctx('password'), {
			isInsert: true,
			onlyDirty: false,
		});

		expect(row.password_hash).toEqual(expect.stringMatching(/^scrypt\$1\$/));
		await expect(
			defaultPasswordHash.verify(
				'correct horse battery',
				row.password_hash as string,
			),
		).resolves.toBe(true);

		field.markClean(state);

		expect(() => field.getQueryValue()).toThrow(
			'Password fields cannot be queried directly',
		);
	});
});
