import type { Knex } from 'knex';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {
	ActiveRecord,
	RecordNotFoundError,
	type FieldBuilder,
} from '../index';
import { Database } from '../index';
import { App } from '../../server';
import { defaultPasswordHash } from '@db3.ai/app/auth/password-hash';
import { RecordValidationError } from '../index';
import {
	createGeneratedTestDatabase,
	type GeneratedTestDatabase,
} from './support/db';
import {
	TestAccount,
	TestPost,
	TestUser,
} from './fixtures/models';

class ColumnSyncRecord extends ActiveRecord {
	static override table = 'column_sync_records';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
			}),
			notes: field.text(),
		};
	}
}

class TextWidenSyncRecord extends ActiveRecord {
	static override table = 'text_widen_sync_records';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			notes: field.text(),
		};
	}
}

class NullableSyncRecord extends ActiveRecord {
	static override table = 'nullable_sync_records';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			optionalValue: field.string({
				column: 'optional_value',
				length: 80,
			}),
		};
	}
}

class CommentSyncRecord extends ActiveRecord {
	static override table = 'comment_sync_records';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			requiredValue: field.string({
				column: 'required_value',
				required: true,
				length: 80,
				comment: 'Required by the model for new writes.',
			}),
		};
	}
}

class IndexSyncRecord extends ActiveRecord {
	static override table = 'index_sync_records';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			account: field.string({
				column: 'account_id',
				required: true,
				length: 26,
				indexes: [
					{
						name: 'index_sync_records_account_score_name_index',
						columns: [
							'account_id',
							{
								name: 'score',
								order: 'desc',
							},
							{
								name: 'name',
								order: 'asc',
							},
						],
					},
				],
			}),
			score: field.integer({
				unsigned: true,
			}),
			name: field.string({
				required: true,
				length: 80,
			}),
		};
	}
}

class DynamicDbRecord extends ActiveRecord {
	static override table = 'dynamic_db_records';
	static override primaryKey = 'id';
	static override returning = false;

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			name: field.string({
				required: true,
				length: 80,
			}),
		};
	}

	declare id: string | null;
	declare name: string | null;
}

class NativeVectorRecord extends ActiveRecord {
	static override table = 'native_vector_records';
	static override primaryKey = 'id';
	static override returning = false;

	/**
	 * Defines a small native MySQL vector field for install and hydration tests.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			embedding: field.vector({
				dimensions: 3,
			}),
		};
	}

	declare id: string | null;
	declare embedding: number[] | null;
}

class SoftDeleteRecord extends ActiveRecord {
	static override table = 'soft_delete_records';
	static override primaryKey = 'id';
	static override returning = false;
	static override softDeletes = true;

	/**
	 * Defines the schema used to exercise ActiveRecord soft deletes.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
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

	declare id: string | null;
	declare name: string | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
	declare deletedAt: Date | null;
}

describe('ActiveRecord database integration', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let testApp: App | null = null;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('active_record');
		db = database.db;
		testApp = new App({ db });

		await new Database(db).install(
			TestAccount,
			TestPost,
			TestUser,
			SoftDeleteRecord,
		);
	});

	beforeEach(async () => {
		await db(SoftDeleteRecord.table).delete();
		await db(TestPost.table).delete();
		await db(TestAccount.table).delete();
		await db(TestUser.table).delete();
	});

	afterAll(async () => {
		await testApp?.close();
		await database?.destroy();
	});

	it('installs fixture schemas into a generated database', async () => {
		await expect(db.schema.hasTable(TestAccount.table)).resolves.toBe(true);
		await expect(db.schema.hasTable(TestPost.table)).resolves.toBe(true);

		const columns = await db(TestAccount.table).columnInfo();

		expect(columns).toHaveProperty('id');
		expect(columns).toHaveProperty('email');
		expect(columns).toHaveProperty('profile_json');
	});

	it('adds missing model columns to existing tables during install', async () => {
		await createLegacyColumnSyncTable();

		try {
			await new Database(db).install(ColumnSyncRecord);

			const columns = await db(ColumnSyncRecord.table).columnInfo();

			expect(columns).toHaveProperty('id');
			expect(columns).toHaveProperty('name');
			expect(columns).toHaveProperty('notes');
			expect(columns).toHaveProperty('legacy_only');
		} finally {
			await db.schema.dropTableIfExists(ColumnSyncRecord.table);
		}
	});

	it('can skip column sync for existing tables during install', async () => {
		await createLegacyColumnSyncTable();

		try {
			await new Database(db, { syncColumns: false }).install(ColumnSyncRecord);

			const columns = await db(ColumnSyncRecord.table).columnInfo();

			expect(columns).toHaveProperty('id');
			expect(columns).toHaveProperty('legacy_only');
			expect(columns).not.toHaveProperty('name');
			expect(columns).not.toHaveProperty('notes');
		} finally {
			await db.schema.dropTableIfExists(ColumnSyncRecord.table);
		}
	});

	it('widens legacy varchar columns when the model now uses text', async () => {
		await createLegacyTextWidenSyncTable();

		try {
			const database = new Database(db);
			const beforeDiffs = await database.diff(TextWidenSyncRecord);

			expect(beforeDiffs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						table: TextWidenSyncRecord.table,
						differences: expect.arrayContaining([
							expect.objectContaining({
								kind: 'type_mismatch',
								column: 'notes',
								blocked: false,
							}),
						]),
					}),
				]),
			);

			await database.install(TextWidenSyncRecord);

			const longNotes = 'x'.repeat(300);

			await db(TextWidenSyncRecord.table).insert({
				id: '01H00000000000000000000002',
				notes: longNotes,
			});

			const row = await db(TextWidenSyncRecord.table)
				.where({ id: '01H00000000000000000000002' })
				.first();
			const afterDiffs = await database.diff(TextWidenSyncRecord);

			expect(row?.notes).toBe(longNotes);
			expect(afterDiffs).toEqual([]);
		} finally {
			await db.schema.dropTableIfExists(TextWidenSyncRecord.table);
		}
	});

	it('adds missing model indexes to existing tables during install', async () => {
		await createLegacyIndexSyncTable();

		try {
			await new Database(db).install(IndexSyncRecord);

			const indexRows = await showIndexRows(IndexSyncRecord.table);
			const syncedRows = indexRows
				.filter(row => {
					return row.Key_name === 'index_sync_records_account_score_name_index';
				})
				.sort((a, b) => {
					return Number(a.Seq_in_index) - Number(b.Seq_in_index);
				});

			expect(syncedRows.map(row => row.Column_name)).toEqual([
				'account_id',
				'score',
				'name',
			]);
			expect(syncedRows.map(row => row.Collation)).toEqual([
				'A',
				'D',
				'A',
			]);
		} finally {
			await db.schema.dropTableIfExists(IndexSyncRecord.table);
		}
	});

	it('relaxes existing optional columns to nullable during install', async () => {
		await createLegacyNullableSyncTable();

		try {
			await new Database(db).install(NullableSyncRecord);

			const columns = await db(NullableSyncRecord.table).columnInfo();

			expect(columns.optional_value.nullable).toBe(true);
		} finally {
			await db.schema.dropTableIfExists(NullableSyncRecord.table);
		}
	});

	it('does not alter existing columns just to sync comments', async () => {
		await createStrictCommentSyncTable();

		try {
			await new Database(db).install({
				reportSchemaDiff: false,
			}, CommentSyncRecord);

			const columns = await db(CommentSyncRecord.table).columnInfo();

			expect(columns.required_value.nullable).toBe(false);
		} finally {
			await db.schema.dropTableIfExists(CommentSyncRecord.table);
		}
	});

	it('reports remaining schema diffs after install', async () => {
		await createLegacyCommentSyncTable();

		try {
			const reports: unknown[] = [];

			await new Database(db).install({
				reportSchemaDiff(diffs) {
					reports.push(diffs);
				},
			}, CommentSyncRecord);

			expect(reports).toHaveLength(1);
			expect(reports[0]).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						table: CommentSyncRecord.table,
						differences: expect.arrayContaining([
							expect.objectContaining({
								kind: 'nullable_mismatch',
								column: 'required_value',
								rowsWithNull: 1,
								blocked: true,
							}),
						]),
					}),
				]),
			);
		} finally {
			await db.schema.dropTableIfExists(CommentSyncRecord.table);
		}
	});

	it('reports missing columns and blocked nullable changes in schema diffs', async () => {
		await createLegacyColumnSyncTable();
		await createLegacyCommentSyncTable();

		try {
			const database = new Database(db);
			const diffs = await database.diff(ColumnSyncRecord, CommentSyncRecord);
			const columnSync = diffs.find(diff => diff.table === ColumnSyncRecord.table);
			const commentSync = diffs.find(diff => diff.table === CommentSyncRecord.table);

			expect(columnSync?.differences).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: 'missing_column',
						column: 'name',
					}),
					expect.objectContaining({
						kind: 'missing_column',
						column: 'notes',
					}),
				]),
			);
			expect(commentSync?.differences).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: 'nullable_mismatch',
						column: 'required_value',
						databaseValue: true,
						modelValue: false,
						rowsWithNull: 1,
						blocked: true,
					}),
				]),
			);
			expect(database.formatDiff(diffs)).toContain('1 rows currently contain NULL');
		} finally {
			await db.schema.dropTableIfExists(ColumnSyncRecord.table);
			await db.schema.dropTableIfExists(CommentSyncRecord.table);
		}
	});

	it('saves, hydrates, finds, and queries records through field-aware APIs', async () => {
		const account = new TestAccount({
			name: 'Steve',
			email: 'STEVE@EXAMPLE.COM',
			password: 'correct horse battery',
			isActive: 'yes',
			profile: {
				theme: 'dark',
				tags: ['integration'],
			},
		});

		await account.save();

		expect(account.isPersisted()).toBe(true);
		expect(account.createdAt).toBeInstanceOf(Date);

		const raw = await db(TestAccount.table)
			.where({ id: account.id })
			.first();

		expect(raw).toMatchObject({
			name: 'Steve',
			email: 'steve@example.com',
			profile_json: '{"theme":"dark","tags":["integration"]}',
		});
		expect(raw.password).toEqual(expect.stringMatching(/^scrypt\$1\$/));
		await expect(
			defaultPasswordHash.verify('correct horse battery', raw.password as string),
		).resolves.toBe(true);

		const found = await TestAccount.findByPk(account.id);

		expect(found).not.toBeNull();
		expect(found?.isPersisted()).toBe(true);
		expect(found?.email).toBe('steve@example.com');
		expect(found?.isActive).toBe(true);
		expect(found?.profile).toEqual({
			theme: 'dark',
			tags: ['integration'],
		});
		expect(found?.password).toBeNull();
		expect(found?.toJSON()).not.toHaveProperty('password');

		const queried = await TestAccount
			.where('email', 'STEVE@EXAMPLE.COM')
			.first();

		expect(queried?.id).toBe(account.id);

		const compact = await TestAccount
			.where('email', 'STEVE@EXAMPLE.COM')
			.select('id', 'email')
			.first();

		expect(compact?.id).toBe(account.id);
		expect(compact?.email).toBe('steve@example.com');
		expect(compact?.name).toBeNull();
		await expect(
			TestAccount
				.where('isActive', true)
				.count(),
		).resolves.toBe(1);

		const queriedByObject = await TestAccount
			.where({
				email: 'STEVE@EXAMPLE.COM',
				isActive: 'yes',
			})
			.first();

		expect(queriedByObject?.id).toBe(account.id);

		const foundByCriteria = await TestAccount.find({
			email: 'STEVE@EXAMPLE.COM',
			isActive: true,
		});

		expect(foundByCriteria?.id).toBe(account.id);
		await expect(TestAccount.findOrFail({
			email: 'missing@example.com',
		})).rejects.toThrow(RecordNotFoundError);
		await expect(TestAccount.findOrFail({
			email: 'missing@example.com',
		})).rejects.toThrow('The requested test account could not be found.');

		const all = await TestAccount
			.query()
			.whereIn('id', [account.id])
			.orderBy('createdAt', 'desc')
			.limit(5)
			.all();

		expect(all).toHaveLength(1);
		expect(all[0].id).toBe(account.id);
	});

	it('saves records through a dynamically bound database connection', async () => {
		await new Database(db).install(DynamicDbRecord);

		try {
			const record = new DynamicDbRecord({
				name: 'Dynamic',
			}).setDb(db);

			await record.save();

			const raw = await db(DynamicDbRecord.table)
				.where({ id: record.id })
				.first();

			expect(raw).toMatchObject({
				name: 'Dynamic',
			});
		} finally {
			await db.schema.dropTableIfExists(DynamicDbRecord.table);
		}
	});

	it('saves and hydrates native MySQL vector fields', async () => {
		await new Database(db).install(NativeVectorRecord);

		try {
			const record = new NativeVectorRecord({
				embedding: [0.1, -0.2, 0.3],
			}).setDb(db);

			await record.save();

			const raw = await db(NativeVectorRecord.table)
				.select<{ embedding_hex?: string }[]>(db.raw('HEX(embedding) AS embedding_hex'))
				.where({ id: record.id })
				.first();

			expect(String(raw?.embedding_hex).toLowerCase()).toBe(
				'cdcccc3dcdcc4cbe9a99993e',
			);

			const defaultFound = await NativeVectorRecord.findByPk(record.id, db);

			expect(defaultFound?.embedding).toBeNull();

			const found = await NativeVectorRecord
				.query(db)
				.withField('embedding')
				.wherePk(record.id)
				.first();

			expect(found?.embedding).toHaveLength(3);
			expect(found?.embedding?.[0]).toBeCloseTo(0.1, 5);
			expect(found?.embedding?.[1]).toBeCloseTo(-0.2, 5);
			expect(found?.embedding?.[2]).toBeCloseTo(0.3, 5);
		} finally {
			await db.schema.dropTableIfExists(NativeVectorRecord.table);
		}
	});

	it('throws validation errors before invalid records are persisted', async () => {
		const account = new TestAccount({
			name: '',
			email: 'not an email',
			password: 'short',
		});

		await expect(account.save()).rejects.toBeInstanceOf(RecordValidationError);

		const count = await db(TestAccount.table).count<{ total: number }[]>({
			total: '*',
		});

		expect(Number(count[0].total)).toBe(0);
	});

	it('enforces unique user emails at the database constraint', async () => {
		const first = new TestUser({
			name: 'First User',
			email: 'UNIQUE@EXAMPLE.COM',
			password: 'correct horse battery',
		});
		const duplicate = new TestUser({
			name: 'Duplicate User',
			email: 'unique@example.com',
			password: 'correct horse battery',
		});

		await first.save();

		await expect(duplicate.save()).rejects.toThrow(/duplicate|unique/i);

		const users = await db(TestUser.table)
			.where({ email: 'unique@example.com' });

		expect(users).toHaveLength(1);
	});

	it('updates records through instance save and query patch', async () => {
		const account = await saveAccount({
			email: 'patch@example.com',
			name: 'Patch',
		});

		account.name = 'Instance Save';
		await account.save();

		const instanceSaved = await TestAccount.findByPk(
			account.id,
		);

		expect(instanceSaved?.name).toBe('Instance Save');
		expect(instanceSaved?.updatedAt).toBeInstanceOf(Date);

		const patched = await TestAccount
			.where('email', 'PATCH@EXAMPLE.COM')
			.patch({
				name: 'Query Patch',
				notes: 'patched',
			});

		expect(patched).toBe(1);

		const found = await TestAccount.findByPk(account.id);

		expect(found?.name).toBe('Query Patch');
		expect(found?.notes).toBe('patched');
	});

	it('deletes records through instance and query APIs', async () => {
		const first = await saveAccount({
			email: 'first-delete@example.com',
			name: 'First Delete',
		});
		const second = await saveAccount({
			email: 'second-delete@example.com',
			name: 'Second Delete',
		});

		await expect(first.delete()).resolves.toBe(1);
		await expect(TestAccount.findByPk(first.id)).resolves.toBeNull();

		await expect(
			TestAccount
				.query()
				.wherePk(second.id)
				.delete(),
		).resolves.toBe(1);
		await expect(TestAccount.findByPk(second.id)).resolves.toBeNull();
	});

	it('soft deletes, scopes, and restores records when a model opts in', async () => {
		const first = await saveSoftDeleteRecord('First Soft Delete');
		const second = await saveSoftDeleteRecord('Second Soft Delete');

		await expect(first.delete()).resolves.toBe(1);

		expect(first.isPersisted()).toBe(true);
		expect(first.trashed()).toBe(true);
		expect(first.deletedAt).toBeInstanceOf(Date);
		expect(first.updatedAt).toBeInstanceOf(Date);

		const rawDeleted = await db(SoftDeleteRecord.table)
			.where({ id: first.id })
			.first();

		expect(rawDeleted?.deleted_at).not.toBeNull();
		await expect(SoftDeleteRecord.findByPk(first.id)).resolves.toBeNull();

		const withTrashed = await SoftDeleteRecord
			.withTrashed()
			.wherePk(first.id)
			.first();

		expect(withTrashed?.id).toBe(first.id);
		expect(withTrashed?.trashed()).toBe(true);

		const onlyTrashed = await SoftDeleteRecord
			.onlyTrashed()
			.orderBy('name', 'asc')
			.all();

		expect(onlyTrashed.map(record => record.id)).toEqual([first.id]);

		await expect(first.restore()).resolves.toBe(1);

		expect(first.trashed()).toBe(false);
		expect(first.deletedAt).toBeNull();

		const restored = await SoftDeleteRecord.findByPk(first.id);

		expect(restored?.id).toBe(first.id);

		await expect(
			SoftDeleteRecord
				.where('name', second.name)
				.delete(),
		).resolves.toBe(1);
		await expect(SoftDeleteRecord.findByPk(second.id)).resolves.toBeNull();
		await expect(
			SoftDeleteRecord
				.onlyTrashed()
				.wherePk(second.id)
				.restore(),
		).resolves.toBe(1);

		const queryRestored = await SoftDeleteRecord.findByPk(second.id);

		expect(queryRestored?.id).toBe(second.id);
	});

	it('physically deletes soft-deletable records through force delete APIs', async () => {
		const instanceDeleted = await saveSoftDeleteRecord('Instance Force Delete');
		const queryDeleted = await saveSoftDeleteRecord('Query Force Delete');

		await instanceDeleted.delete();
		await expect(instanceDeleted.forceDelete()).resolves.toBe(1);
		await expect(
			SoftDeleteRecord
				.withTrashed()
				.wherePk(instanceDeleted.id)
				.first(),
		).resolves.toBeNull();

		await queryDeleted.delete();
		await expect(
			SoftDeleteRecord
				.onlyTrashed()
				.wherePk(queryDeleted.id)
				.forceDelete(),
		).resolves.toBe(1);
		await expect(
			SoftDeleteRecord
				.withTrashed()
				.wherePk(queryDeleted.id)
				.first(),
		).resolves.toBeNull();
	});

	it('persists link fields and loads related records explicitly', async () => {
		const account = await saveAccount({
			email: 'author@example.com',
			name: 'Author',
		});
		const post = new TestPost({
			author: account,
			title: 'Linked post',
			metadata: {
				published: false,
				labels: ['draft', 'linked'],
			},
		});

		await post.save();

		const rawPost = await db(TestPost.table)
			.where({ id: post.id })
			.first();

		expect(rawPost.author_id).toBe(account.id);

		const found = await TestPost
			.where('author', account)
			.first();

		expect(found?.author?.id).toBe(account.id);
		expect(found?.metadata).toEqual({
			published: false,
			labels: ['draft', 'linked'],
		});
		expect(found?.toJSON()).toMatchObject({
			author: account.id,
			title: 'Linked post',
		});

		const foundWithAuthor = await TestPost
			.where('author', account)
			.with('test_accounts')
			.first();

		expect(foundWithAuthor?.author?.isLoaded()).toBe(true);
		expect(foundWithAuthor?.author?.getLoaded()?.email).toBe('author@example.com');
		expect(foundWithAuthor?.toJSON()).toMatchObject({
			author: {
				id: account.id,
				email: 'author@example.com',
				name: 'Author',
			},
			title: 'Linked post',
		});

		const loadedAuthor = await found?.author?.load();

		expect(loadedAuthor?.id).toBe(account.id);
		expect(loadedAuthor?.email).toBe('author@example.com');
	});

	it('queries a user blog collection through a link field', async () => {
		const author = await saveAccount({
			email: 'blog-author@example.com',
			name: 'Blog Author',
		});
		const otherAuthor = await saveAccount({
			email: 'other-author@example.com',
			name: 'Other Author',
		});

		await savePost({
			author,
			title: 'First blog',
		});
		await savePost({
			author,
			title: 'Second blog',
		});
		await savePost({
			author: otherAuthor,
			title: 'Other author blog',
		});

		const blogs = await TestPost
			.where('author', author)
			.orderBy('title', 'asc')
			.all();

		expect(blogs.map(blog => blog.title)).toEqual([
			'First blog',
			'Second blog',
		]);
		expect(blogs.map(blog => blog.author?.id)).toEqual([
			author.id,
			author.id,
		]);

		const loadedAuthors = await Promise.all(
			blogs.map(blog => blog.author?.load()),
		);

		expect(loadedAuthors.map(user => user?.email)).toEqual([
			'blog-author@example.com',
			'blog-author@example.com',
		]);
	});

	async function createLegacyColumnSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(ColumnSyncRecord.table);
		await db.schema.createTable(ColumnSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('legacy_only', 80);
		});
	}

	async function createLegacyNullableSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(NullableSyncRecord.table);
		await db.schema.createTable(NullableSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('optional_value', 80).notNullable();
		});
	}

	async function createLegacyTextWidenSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(TextWidenSyncRecord.table);
		await db.schema.createTable(TextWidenSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('notes', 255).nullable();
		});
	}

	async function createLegacyIndexSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(IndexSyncRecord.table);
		await db.schema.createTable(IndexSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('account_id', 26).notNullable();
			table.integer('score').unsigned();
			table.string('name', 80).notNullable();
		});
	}

	async function createLegacyCommentSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(CommentSyncRecord.table);
		await db.schema.createTable(CommentSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('required_value', 80).nullable();
		});
		await db(CommentSyncRecord.table).insert({
			id: '01H00000000000000000000000',
			required_value: null,
		});
	}

	async function createStrictCommentSyncTable(): Promise<void> {
		await db.schema.dropTableIfExists(CommentSyncRecord.table);
		await db.schema.createTable(CommentSyncRecord.table, table => {
			table.specificType('id', 'char(26)').primary().notNullable();
			table.string('required_value', 80).notNullable();
		});
		await db(CommentSyncRecord.table).insert({
			id: '01H00000000000000000000001',
			required_value: 'set',
		});
	}

	async function showIndexRows(tableName: string): Promise<Array<Record<string, unknown>>> {
		const result = await db.raw('SHOW INDEX FROM ??', [tableName]);
		const [rows] = Array.isArray(result) ? result : [];

		return Array.isArray(rows) ? rows : [];
	}

	async function saveAccount(input: {
		email: string;
		name: string;
	}): Promise<TestAccount> {
		const account = new TestAccount({
			name: input.name,
			email: input.email,
			password: 'correct horse battery',
			isActive: true,
		});

		await account.save();

		return account;
	}

	async function savePost(input: {
		author: TestAccount;
		title: string;
	}): Promise<TestPost> {
		const post = new TestPost({
			author: input.author,
			title: input.title,
			metadata: {
				published: true,
				labels: ['blog'],
			},
		});

		await post.save();

		return post;
	}

	/**
	 * Persists a simple soft-deletable record for integration tests.
	 */
	async function saveSoftDeleteRecord(name: string): Promise<SoftDeleteRecord> {
		const record = new SoftDeleteRecord({
			name,
		});

		await record.save();

		return record;
	}
});
