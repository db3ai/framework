import { describe, expect, it } from 'vitest';
import { ActiveRecord, type FieldBuilder } from '../index';
import { defaultPasswordHash } from '@db3.ai/app/auth/password-hash';
import { Database } from '../index';
import { EmailField, EntityRef, LinkField } from '../fields';
import { RecordValidationError } from '../index';
import { validate } from '../../validation';
import { TestAccount, TestPost, type TestProfile } from './fixtures/models';

class DuplicateColumnRecord extends ActiveRecord {
	static override table = 'duplicate_column_records';

	static override fields(field: FieldBuilder) {
		return {
			first: field.string({ column: 'shared_column' }),
			second: field.string({ column: 'shared_column' }),
		};
	}
}

class FieldDefinitionRecord extends ActiveRecord {
	static override table = 'field_definition_records';

	static override fields(field: FieldBuilder) {
		return {
			email: field.email(),
			backupEmail: EmailField,
		};
	}

	declare email: string | null;
	declare backupEmail: string | null;
}

class CommentedRecord extends ActiveRecord {
	static override table = 'commented_records';
	static override comment = 'Records with database-native comments.';

	static override fields(field: FieldBuilder) {
		return {
			title: field.string({
				comment: 'Public title shown in listings.',
				required: true,
				maxLength: 80,
			}),
		};
	}
}

class RequestRecord extends ActiveRecord {
	static override table = 'request_records';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			title: field.string(),
			site: field.url(),
		};
	}

	declare id: string | null;
	declare title: string | null;
	declare site: string | null;
}

class GuardedRequestRecord extends ActiveRecord {
	static override table = 'guarded_request_records';
	static override requestFillable = ['title'];

	static override fields(field: FieldBuilder) {
		return {
			title: field.string(),
			site: field.url(),
		};
	}

	declare title: string | null;
	declare site: string | null;
}

class CustomAccessorRecord extends ActiveRecord {
	static override table = 'custom_accessor_records';

	static override fields(field: FieldBuilder) {
		return {
			settings: field.json<Record<string, unknown>>(),
		};
	}

	/** Returns settings through a model-owned normalized interface. */
	get settings(): Record<string, unknown> {
		const value = this.$get('settings');

		return typeof value === 'object' && value !== null
			? value as Record<string, unknown>
			: {};
	}

	/** Writes settings through the underlying ActiveRecord field. */
	set settings(value: Record<string, unknown> | null) {
		this.$set('settings', value);
	}
}

describe('ActiveRecord interface', () => {
	it('preserves model-defined accessors for configured fields', () => {
		const record = new CustomAccessorRecord({
			settings: null,
		});

		expect(record.settings).toEqual({});

		record.settings = {
			enabled: true,
		};

		expect(record.settings).toEqual({
			enabled: true,
		});
	});

	it('normalizes, validates, serializes, and prepares fixture records through fields', async () => {
		const account = new TestAccount({
			name: '  Steve  ',
			email: 'STEVE@EXAMPLE.COM',
			password: 'correct horse battery',
			isActive: 'off',
			profile: '{"theme":"dark","tags":["db","test"]}',
			notes: '  hello  ',
		});

		expect(account.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
		expect(account.name).toBe('Steve');
		expect(account.email).toBe('steve@example.com');
		expect(account.emailDomain).toBe('example.com');
		expect(account.password).toBeNull();
		expect(account.isActive).toBe(false);
		expect(account.profile).toEqual({
			theme: 'dark',
			tags: ['db', 'test'],
		});
		expect(account.notes).toBe('hello');

		await expect(account.validate()).resolves.toBe(true);
		expect(account.getErrors()).toEqual([]);

		const json = account.toJSON();

		expect(json).toMatchObject({
			name: 'Steve',
			email: 'steve@example.com',
			isActive: false,
			profile: {
				theme: 'dark',
				tags: ['db', 'test'],
			},
		});
		expect(json).not.toHaveProperty('password');

		const row = await account.getDataForDb({ isInsert: true });

		expect(row).toMatchObject({
			id: account.id,
			name: 'Steve',
			email: 'steve@example.com',
			is_active: false,
			profile_json: JSON.stringify({
				theme: 'dark',
				tags: ['db', 'test'],
			} satisfies TestProfile),
			notes: 'hello',
		});
		expect(row.password).toEqual(expect.stringMatching(/^scrypt\$1\$/));
		await expect(
			defaultPasswordHash.verify('correct horse battery', row.password as string),
		).resolves.toBe(true);
		expect(row.created_at).toBeInstanceOf(Date);
	});

	it('tracks validation errors by logical field', async () => {
		const account = new TestAccount({
			email: 'not an email',
			password: 'short',
		});

		await expect(account.validate()).resolves.toBe(false);

		expect(account.hasErrors()).toBe(true);
		expect(account.getFieldErrors('name')).toEqual([
			expect.objectContaining({
				field: 'name',
				code: 'required',
			}),
		]);
		expect(account.getErrors()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: 'email', code: 'email' }),
				expect.objectContaining({ field: 'password', code: 'minLength' }),
			]),
		);

		account.clearErrors();

		expect(account.hasErrors()).toBe(false);
	});

	it('keeps live field state isolated between record instances', async () => {
		const invalid = new TestAccount({
			email: 'not an email',
			password: 'short',
		});
		const valid = new TestAccount({
			name: 'Valid',
			email: 'valid@example.com',
			password: 'correct horse battery',
		});

		await expect(invalid.validate()).resolves.toBe(false);
		await expect(valid.validate()).resolves.toBe(true);

		expect(invalid.getFieldErrors('email')).toEqual([
			expect.objectContaining({
				field: 'email',
				code: 'email',
			}),
		]);
		expect(valid.getFieldErrors('email')).toEqual([]);

		invalid.name = 'Changed Invalid';

		expect(valid.name).toBe('Valid');
	});

	it('creates live fields from config definitions and class shorthand', () => {
		const record = new FieldDefinitionRecord({
			email: 'PRIMARY@EXAMPLE.COM',
			backupEmail: 'BACKUP@EXAMPLE.COM',
		});

		expect(record.email).toBe('primary@example.com');
		expect(record.backupEmail).toBe('backup@example.com');
		expect(record.toJSON()).toMatchObject({
			email: 'primary@example.com',
			backupEmail: 'backup@example.com',
		});
	});

	it('throws validation errors from save-compatible validation failures', async () => {
		const account = new TestAccount({
			name: '',
			email: 'not an email',
			password: 'short',
		});

		await account.validate();

		const error = new RecordValidationError(account.getErrors());

		expect(error.name).toBe('RecordValidationError');
		expect(error.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: 'name', code: 'required' }),
				expect.objectContaining({ field: 'email', code: 'email' }),
				expect.objectContaining({ field: 'password', code: 'minLength' }),
			]),
		);
	});

	it('hydrates database rows and only emits dirty write data on updates', async () => {
		const account = TestAccount.fromDb({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			name: 'Loaded',
			email: 'loaded@example.com',
			password: 'hashed:existing',
			is_active: 1,
			profile_json: '{"theme":"light","tags":["loaded"]}',
			notes: null,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
		}) as TestAccount;

		expect(account.isPersisted()).toBe(true);
		expect(account.createdAt).toBeInstanceOf(Date);
		expect(account.updatedAt).toBeInstanceOf(Date);
		expect(account.password).toBeNull();

		await expect(
			account.getDataForDb({ isInsert: false, onlyDirty: true }),
		).resolves.toEqual(expect.objectContaining({ updated_at: expect.any(Date) }));

		account.set('name', 'Updated');

		const row = await account.getDataForDb({
			isInsert: false,
			onlyDirty: true,
		});

		expect(row).toMatchObject({
			name: 'Updated',
			updated_at: expect.any(Date),
		});
		expect(row).not.toHaveProperty('email');
		expect(row).not.toHaveProperty('password');
		expect(row).not.toHaveProperty('profile_json');
	});

	it('supports dynamic field assignment and rejects unknown fields', () => {
		const account = new TestAccount();

		account.assign({ name: 'Known', unknown: 'ignored' });

		expect(account.get('name')).toBe('Known');
		expect(account.hasField('name')).toBe(true);
		expect(account.hasField('unknown')).toBe(false);
		expect(() => account.set('unknown', 'value')).toThrow(
			'Unknown field "unknown"',
		);
		expect(() => account.getFieldErrors('unknown')).toThrow(
			'Unknown field "unknown"',
		);
	});

	it('assigns request values through logical keys and explicit request maps', () => {
		const record = new RequestRecord();
		const generatedId = record.id;
		const requestMap = {
			recordId: 'id',
			name: 'title',
			website: 'site',
		};

		record.setFromRequestWithMap({
			recordId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			name: '  Marketing Site  ',
			website: 'example.com',
		}, requestMap);

		expect(record.id).toBe(generatedId);
		expect(record.title).toBe('Marketing Site');
		expect(record.site).toBe('https://example.com/');

		record.setFromRequestWithMap({
			recordId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
		}, requestMap, {
			includePrimary: true,
			includeGenerated: true,
		});

		expect(record.id).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
	});

	it('honors model fillable config when filling from requests', () => {
		const record = new GuardedRequestRecord();

		record.setFromRequest({
			title: 'Allowed',
			site: 'example.com',
		});

		expect(record.title).toBe('Allowed');
		expect(record.site).toBeNull();
	});

	it('generates validation rules from model fields', () => {
		const rules = TestAccount.validationRules();

		expect(rules).toMatchObject({
			name: [
				'required',
				'string',
				{
					rule: 'maxLength',
					value: 80,
				},
			],
			email: expect.arrayContaining(['required', 'string', 'email']),
		});
		expect(rules).not.toHaveProperty('id');
		expect(rules).not.toHaveProperty('password');

		const result = validate({
			name: '',
			email: 'not-email',
			isActive: 'yes',
		}, rules);

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ field: 'name', rule: 'required' }),
				expect.objectContaining({ field: 'email', rule: 'email' }),
			]),
		);
	});

	it('collects schema metadata from fixture models', () => {
		const accountSchema = Database.getSchema(TestAccount);
		const postSchema = Database.getSchema(TestPost);

		expect(accountSchema.columns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'id',
					type: 'char(26)',
					nullable: false,
					primary: true,
				}),
				expect.objectContaining({
					name: 'email',
					type: 'varchar(255)',
					nullable: false,
				}),
				expect.objectContaining({
					name: 'profile_json',
					type: 'text',
				}),
			]),
		);
		expect(postSchema.foreignKeys).toEqual([
			expect.objectContaining({
				column: 'author_id',
				referencesTable: TestAccount.table,
				referencesColumn: 'id',
				onDelete: 'CASCADE',
			}),
		]);
		expect(() => Database.getSchema(DuplicateColumnRecord)).toThrow(
			'Duplicate column "shared_column"',
		);
	});

	it('maps model field comments into database column schema metadata', () => {
		const schema = Database.getSchema(CommentedRecord);

		expect(CommentedRecord.comment).toBe('Records with database-native comments.');
		expect(schema.columns).toEqual([
			expect.objectContaining({
				name: 'title',
				comment: 'Public title shown in listings.',
			}),
		]);
	});

	it('handles link fields as entity references', () => {
		const account = new TestAccount({
			name: 'Linked',
			email: 'linked@example.com',
			password: 'correct horse battery',
		});
		const post = new TestPost({
			author: account,
			title: 'A linked post',
			metadata: {
				published: false,
				labels: ['draft'],
			},
		});

		expect(post.author?.id).toBe(account.id);
		expect(post.author?.idOrFail()).toBe(account.id);
		expect(post.author?.stringIdOrFail()).toBe(String(account.id));
		expect(EntityRef.idOrFail(post.author)).toBe(account.id);
		expect(EntityRef.stringIdOrFail(post.author)).toBe(String(account.id));
		expect(post.author?.isLoaded()).toBe(true);
		expect(post.author?.getLoaded()).toBe(account);
		expect(() => EntityRef.idOrFail(null, 'Author is required.')).toThrow('Author is required.');
		expect(() => new EntityRef(() => TestAccount, null).idOrFail('Author id is required.')).toThrow('Author id is required.');
		expect(post.toJSON()).toMatchObject({
			author: account.id,
			title: 'A linked post',
		});

		const authorField = post.getBoundField('author');

		expect(authorField).toBeInstanceOf(LinkField);

		if (authorField instanceof LinkField) {
			authorField.setBoundLoadedRecord(account);
		}

		expect(post.toJSON()).toMatchObject({
			author: {
				id: account.id,
				email: 'linked@example.com',
				name: 'Linked',
			},
			title: 'A linked post',
		});
	});
});
