import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth, AuthProvider, AuthToken, PasswordLoginAttempt, PasswordSuspendedError, PasswordResetToken, UserIdentity, defaultPasswordHash } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { ActiveRecord } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';

/** Disposable credential shared only by this isolated test run. */
const password = randomUUID();
const maxFailedAttempts = 3;
let database: GeneratedTestDatabase;
let application: App;
let accountNumber = 0;

/** Registers an isolated real password account. */
async function account() {
	const email = `suspension-${++accountNumber}@example.test`;
	const issued = await application.auth.registerWithPassword({ name: 'Suspension test', email, password });
	return { email, user: issued.user };
}

/** Attempts password sign-in through the public token-issuance API. */
function signIn(email: string, attempt: string, auth = application.auth) {
	return auth.issueTokenForProvider('password', { email, password: attempt });
}

/** Reads the durable attempt state in the disposable database. */
async function attemptRow(email: string): Promise<PasswordLoginAttempt | null> {
	return ActiveRecord.withDb(database.db, () => PasswordLoginAttempt.where('identityHash', PasswordLoginAttempt.identityKey(email)).first()) as Promise<PasswordLoginAttempt | null>;
}

/** Reaches the configured threshold with sequential incorrect passwords. */
async function suspend(email: string): Promise<void> {
	for (let index = 1; index < maxFailedAttempts; index++) expect(await signIn(email, 'wrong-password-123')).toBeNull();
	await expect(signIn(email, 'wrong-password-123')).rejects.toBeInstanceOf(PasswordSuspendedError);
}

describe('PasswordLoginAttempt', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('password_attempts');
		application = new App({ db: database.db, config: { auth: { providers: { password: { driver: 'password', suspension: { maxFailedAttempts } } } } } });
		await application.db.install(UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken);
	});
	afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); } });

	it('records normalized known and unknown emails and counts their failures identically', async () => {
		const owner = await account();
		const unknown = 'unknown-suspension@example.test';
		for (const email of [owner.email, unknown]) {
			await suspend(` ${email.toUpperCase()} `);
			const row = await attemptRow(email);
			expect(row?.failedAttempts).toBe(3);
			expect(row?.suspendedAt).toBeInstanceOf(Date);
			expect(row?.identity).toBe(email);
			expect(row?.toJSON()).toMatchObject({ identity: email, identityHash: PasswordLoginAttempt.identityKey(email) });
			expect(JSON.stringify(row?.toJSON())).not.toContain('wrong-password-123');
			await expect(signIn(email, password)).rejects.toThrow(new PasswordSuspendedError().message);
		}
	});

	it('populates legacy digest-only records and records activity while preserving suspension', async () => {
		const email = 'legacy-suspension@example.test';
		const oldActivity = new Date('2000-01-01T00:00:00Z');
		await ActiveRecord.withDb(database.db, async () => {
			await PasswordLoginAttempt.create({ identityHash: PasswordLoginAttempt.identityKey(email), failedAttempts: 3, suspendedAt: oldActivity }).save();
		});
		// Seed historical timestamps below field automation to represent a legacy row.
		await database.db(PasswordLoginAttempt.table).where('identity_hash', PasswordLoginAttempt.identityKey(email)).update({ created_at: oldActivity, updated_at: oldActivity });
		expect((await attemptRow(email))?.identity).toBeNull();
		await expect(signIn(` ${email.toUpperCase()} `, password)).rejects.toBeInstanceOf(PasswordSuspendedError);
		const row = await attemptRow(email);
		expect(row?.identity).toBe(email);
		expect(row?.failedAttempts).toBe(3);
		expect(row?.suspendedAt).toEqual(oldActivity);
		expect(row?.get('createdAt')).toEqual(oldActivity);
		expect((row?.get('updatedAt') as Date).getTime()).toBeGreaterThan(oldActivity.getTime());
	});

	it('keeps suspension indefinitely and does not count further attempts', async () => {
		const owner = await account();
		await suspend(owner.email);
		await ActiveRecord.withDb(database.db, () => PasswordLoginAttempt.where('identityHash', PasswordLoginAttempt.identityKey(owner.email)).patch({ suspendedAt: new Date('2000-01-01T00:00:00Z') }));
		await expect(signIn(owner.email, password)).rejects.toBeInstanceOf(PasswordSuspendedError);
		expect((await attemptRow(owner.email))?.failedAttempts).toBe(3);
	});

	it('does not verify an accent-equivalent SQL identity under a different attempt key', async () => {
		const owner = await account();
		const alias = owner.email.replace('suspension', 'suspensión');
		expect(await signIn(alias, password)).toBeNull();
		expect((await attemptRow(alias))?.failedAttempts).toBe(1);
		expect(await attemptRow(owner.email)).toBeNull();
	});

	it('uses the configured hash format for unknown identities', async () => {
		const auth = new Auth({ db: application.db, passwordHash: {
			/** Represents a versioned application hasher using real scrypt. */
			async hash(value) { return `custom:${await defaultPasswordHash.hash(value)}`; },
			/** Accepts only this driver's format, as an alternate algorithm would. */
			async verify(value, hash) {
				if (!hash.startsWith('custom:')) throw new Error('Unsupported application hash format.');
				return defaultPasswordHash.verify(value, hash.slice('custom:'.length));
			},
		} });
		expect(await signIn('custom-unknown@example.test', password, auth)).toBeNull();
		expect((await attemptRow('custom-unknown@example.test'))?.failedAttempts).toBe(1);
	});

	it('clears consecutive failures on success before suspension and isolates other identities', async () => {
		const owner = await account();
		const other = await account();
		await signIn(owner.email, 'wrong-password-123');
		expect(await signIn(owner.email, password)).not.toBeNull();
		expect((await attemptRow(owner.email))?.failedAttempts).toBe(0);
		await suspend(owner.email);
		expect(await signIn(other.email, password)).not.toBeNull();
	});

	it('clears suspension only after successful identity-matched recovery', async () => {
		const owner = await account();
		await suspend(owner.email);
		const reset = await application.auth.createPasswordResetToken(owner.user);
		expect(await application.auth.resetPassword({ email: 'other@example.test', token: reset.token, password })).toBeNull();
		await expect(application.auth.resetPassword({ email: owner.email, token: reset.token, password: 'short' })).rejects.toThrow();
		expect((await attemptRow(owner.email))?.suspendedAt).not.toBeNull();
		const replacement = 'replacement-test-password-456';
		expect(await application.auth.resetPassword({ email: owner.email, token: reset.token, password: replacement })).not.toBeNull();
		expect((await attemptRow(owner.email))?.suspendedAt).toBeNull();
		expect((await attemptRow(owner.email))?.suspensionId).toBeNull();
		expect((await attemptRow(owner.email))?.failedAttempts).toBe(0);
		expect(await signIn(owner.email, replacement)).not.toBeNull();
	});

	it('does not clear an unknown identity suspension when a credential is subsequently created', async () => {
		const email = 'future-suspended@example.test';
		await suspend(email);
		await application.auth.registerWithPassword({ name: 'Later registration', email, password });
		await expect(signIn(email, password)).rejects.toBeInstanceOf(PasswordSuspendedError);
	});

	it('serializes concurrent first attempts and stops counting exactly at the threshold', async () => {
		const email = 'concurrent-unknown@example.test';
		const results = await Promise.allSettled(Array.from({ length: 12 }, () => signIn(email, 'wrong-password-123')));
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
		for (const result of results.filter(result => result.status === 'rejected')) expect(result.reason).toBeInstanceOf(PasswordSuspendedError);
		const transitions = results.filter(result => result.status === 'rejected' && result.reason.suspension);
		expect(transitions).toHaveLength(1);
		const row = await attemptRow(email);
		expect((transitions[0] as PromiseRejectedResult).reason.suspension).toEqual({ attemptId: row?.id, suspensionId: row?.suspensionId });
		expect((await attemptRow(email))?.failedAttempts).toBe(3);
	});

	it('cannot let a concurrent correct password erase the failure that suspends sign-in', async () => {
		const owner = await account();
		await signIn(owner.email, 'wrong-password-123');
		await signIn(owner.email, 'wrong-password-123');
		let entered!: () => void;
		let release!: () => void;
		const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
		const gate = new Promise<void>(resolve => { release = resolve; });
		const auth = new Auth({
			db: application.db,
			providers: { password: { driver: 'password', suspension: { maxFailedAttempts } } },
			passwordHash: {
				/** Performs real hashing for this controlled concurrency schedule. */
				hash: value => defaultPasswordHash.hash(value),
				/** Holds the threshold-reaching verification while another request queues. */
				async verify(value, hash) {
					const valid = await defaultPasswordHash.verify(value, hash);
					if (!valid) { entered(); await gate; }
					return valid;
				},
			},
		});
		const failure = signIn(owner.email, 'wrong-password-123', auth).catch(error => error);
		await enteredPromise;
		const success = signIn(owner.email, password, auth).catch(error => error);
		release();
		expect(await failure).toBeInstanceOf(PasswordSuspendedError);
		expect(await success).toBeInstanceOf(PasswordSuspendedError);
		expect((await attemptRow(owner.email))?.suspendedAt).not.toBeNull();
	});

	it('can disable accounting and rejects invalid thresholds at startup', async () => {
		const owner = await account();
		const auth = new Auth({ db: application.db, providers: { password: { driver: 'password', suspension: false } } });
		for (let index = 0; index < 4; index++) expect(await signIn(owner.email, 'wrong-password-123', auth)).toBeNull();
		expect(await attemptRow(owner.email)).toBeNull();
		expect(() => new Auth({ db: application.db, providers: { password: { driver: 'password', suspension: { maxFailedAttempts: 0 } } } })).toThrow(/maxFailedAttempts/);
	});
});
