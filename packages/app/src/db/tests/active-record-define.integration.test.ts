import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { ActiveRecord, Database, PasswordField, RecordValidationError } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from './support/db';

/** A directly defined model whose properties come entirely from its fields. */
const Note = ActiveRecord.define({
	table: 'defined_notes',
	returning: false,
	/** Defines storage and application types without duplicate property declarations. */
	fields: field => ({
		id: field.ulid(),
		title: field.string({ required: true, column: 'note_title' }),
		completed: field.boolean({ default: false }),
		details: field.json<{ tags: string[] }>(),
	}),
});

/** Real storage exercises inferred fields through the unchanged record lifecycle. */
class Account extends ActiveRecord.define({
	table: 'defined_accounts',
	returning: false,
	requestFillable: ['email'],
	fields: field => ({
		id: field.ulid(),
		email: field.email({ required: true, column: 'email_address' }),
		password: field.password({ required: true }),
		credentials: field.encryptedJson<{ token: string }>({ selectedByDefault: false }),
		createdAt: field.timestamp({ auto: 'create', column: 'created_at' }),
	}),
}) {
	/** Returns a domain from the normalized application value. */
	domain(): string | null { return this.email?.split('@')[1] ?? null; }
	/** Keeps a custom static available to ordinary and defined descendants. */
	static kind(): string { return 'account'; }
}

/** An ordinary subclass returned by inherited statics. */
class Customer extends Account {
	/** Identifies custom behavior on hydrated subclass instances. */
	customer(): true { return true; }
}

/** A further definition preserves both levels of application behavior. */
class Member extends Customer.define({
	fields: field => ({ nickname: field.string(), email: field.email({ required: true, column: 'email_address', maxLength: 80 }) }),
}) {}

describe('ActiveRecord.define database integration', () => {
	let database: GeneratedTestDatabase | undefined;
	let application: App | undefined;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('define');
		application = new App({ db: database.db, config: { security: { key: '0123456789abcdef0123456789abcdef' } } });
		await new Database(database.db).install(Member, Note);
	});

	beforeEach(async () => {
		await database!.db(Member.table).delete();
		await database!.db(Note.table).delete();
	});

	afterAll(async () => {
		try { await application?.close(); } finally { await database?.destroy(); }
	});

	/** Verifies inferred properties at compile time and through a real SQL lifecycle. */
	it('creates, saves, queries, updates and deletes a directly defined model without declare statements', async () => {
		const note = Note.create({ title: ' Inferred fields ', details: { tags: ['typescript'] } });
		expectTypeOf(note.id).toEqualTypeOf<string | null>();
		expectTypeOf(note.title).toEqualTypeOf<string | null>();
		expectTypeOf(note.completed).toEqualTypeOf<boolean | null>();
		expectTypeOf(note.details).toEqualTypeOf<{ tags: string[] } | null>();
		expect(note).toBeInstanceOf(Note);
		expect(note.isPersisted()).toBe(false);
		expect(note.title).toBe('Inferred fields');
		expect(note.completed).toBe(false);
		expect(await Note.query().count()).toBe(0);

		await note.save();
		expect(note.isPersisted()).toBe(true);
		expect(note.isDirty()).toBe(false);

		const found = await Note.where('title', 'Inferred fields').firstOrFail();
		expectTypeOf(found.title).toEqualTypeOf<string | null>();
		expectTypeOf(found.completed).toEqualTypeOf<boolean | null>();
		expectTypeOf(found.details).toEqualTypeOf<{ tags: string[] } | null>();
		expect(found).toBeInstanceOf(Note);
		expect(found.id).toBe(note.id);
		expect(found.details).toEqual({ tags: ['typescript'] });
		found.title = ' Updated title ';
		found.completed = true;
		found.details = { tags: ['typescript', 'persisted'] };
		expect(found.title).toBe('Updated title');
		expect(found.isDirty('title')).toBe(true);
		await found.save();

		const reloaded = await Note.findOrFail(note.id);
		expectTypeOf(reloaded.title).toEqualTypeOf<string | null>();
		expect(reloaded.toJSON()).toEqual({
			id: note.id,
			title: 'Updated title',
			completed: true,
			details: { tags: ['typescript', 'persisted'] },
		});
		expect(reloaded.isDirty()).toBe(false);
		await expect(reloaded.delete()).resolves.toBe(1);
		expect(await Note.find(note.id)).toBeNull();
		expect(await Note.query().count()).toBe(0);
	});

	it('creates synchronously without inserting, then saves and hydrates the actual subclass', async () => {
		const record = Member.create({ email: ' USER@EXAMPLE.COM ', password: 'correct horse battery', credentials: { token: 'test-secret' }, nickname: ' Member ' });
		expect(record).toBeInstanceOf(Member);
		expect(record).not.toBeInstanceOf(Promise);
		expect(record.isPersisted()).toBe(false);
		expect(await Member.query().count()).toBe(0);
		expect(record.domain()).toBe('example.com');
		expect(Member.kind()).toBe('account');
		expect(record.customer()).toBe(true);
		expect(record.password).toBeNull();
		expect(await record.save()).toBe(record);
		expect(record.isPersisted()).toBe(true);
		expect(record.createdAt).toBeInstanceOf(Date);
		expect(record.isDirty()).toBe(false);
		expect(await Member.query().count()).toBe(1);

		const raw = await database!.db(Member.table).where({ id: record.id }).first();
		expect(raw.email_address).toBe('user@example.com');
		expect(raw.password).not.toBe('correct horse battery');
		expect(raw.credentials).toMatch(/^security:1:aes-256-gcm:/);
		expect(raw.credentials).not.toContain('test-secret');
		const found = await Member.query().withField('credentials').wherePk(record.id).firstOrFail();
		expect(found).toBeInstanceOf(Member);
		expect(found.customer()).toBe(true);
		expect(found.domain()).toBe('example.com');
		expect(found.credentials).toEqual({ token: 'test-secret' });
		expect(found.toJSON()).not.toHaveProperty('password');
		expect(found.toJSON()).not.toHaveProperty('credentials');
		const password = found.getBoundField('password') as PasswordField;
		await expect(password.verifyPassword('correct horse battery')).resolves.toBe(true);
		found.assign({ password: 'a different correct password' });
		await found.save();
		await expect(password.verifyPassword('a different correct password')).resolves.toBe(true);
		await expect(password.verifyPassword('correct horse battery')).resolves.toBe(false);

		const ordinary = await Customer.findOrFail(record.id);
		expect(ordinary).toBeInstanceOf(Customer);
		expect(ordinary.customer()).toBe(true);
		expect(ordinary.credentials).toBeNull();
		for (const result of [await Member.find(record.id), await Member.findByPk(record.id), await Member.where('id', record.id).first()]) {
			expect(result).toBeInstanceOf(Member);
			expect(result?.domain()).toBe('example.com');
		}
	});

	it('preserves request guards, validation failures, and independent password state', async () => {
		const record = Member.create({ password: 'short' });
		record.setFromRequest({ email: 'invalid', id: 'untrusted', credentials: { token: 'injected' } });
		expect(record.id).not.toBe('untrusted');
		expect(record.credentials).toBeNull();
		await expect(record.save()).rejects.toBeInstanceOf(RecordValidationError);
		expect(record.isPersisted()).toBe(false);
		expect(record.getFieldErrors('email')).not.toEqual([]);
		expect(record.getFieldErrors('password')).not.toEqual([]);
		const clean = Member.create();
		expect(clean.getFieldErrors('password')).toEqual([]);
		await expect((clean.getBoundField('password') as PasswordField).verifyPassword('a different correct password')).resolves.toBe(false);
		expect(await Member.query().count()).toBe(0);
	});
});
