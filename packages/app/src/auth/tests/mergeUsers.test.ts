import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthProvider, AuthProviderLinkedError, AuthToken, PasswordLoginAttempt, PasswordResetToken, UserIdentity } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { App } from '@db3.ai/app/server';

const password = 'merge-test-password-123';
let database: GeneratedTestDatabase;
let application: App;
let accountNumber = 0;

/** A provider that verifies any subject, standing in for a real Google credential. */
const google = { provider: 'google', async verify(input: { subject: string; email: string }) { return { provider: 'google', providerUserId: input.subject, email: input.email, name: 'Merge test' }; } };

/** Creates an independent password account with one session. */
async function account() {
	return application.auth.registerWithPassword({ name: 'Merge test', email: `merge-${++accountNumber}@example.test`, password });
}

describe('merging two accounts one person controls', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('auth_merge');
		application = new App({ db: database.db, auth: { providers: { password: true, google } } });
		await application.db.install(UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken);
	});

	afterAll(async () => {
		try { await application?.close(); } finally { await database?.destroy(); }
	});

	it('names the account that already holds a provider identity', async () => {
		const holder = await account();
		const current = await account();
		await application.auth.linkProvider(holder.user, 'google', { subject: 'g-1', email: holder.user.email });
		const error = await application.auth.linkProvider(current.user, 'google', { subject: 'g-1', email: holder.user.email }).catch(caught => caught);
		expect(error).toBeInstanceOf(AuthProviderLinkedError);
		expect(error).toMatchObject({ provider: 'google', providerUserId: 'g-1', userId: String(holder.user.id) });
	});

	it('moves the sign-in and app data, keeps the surviving password and deletes the merged account', async () => {
		const other = await account();
		const current = await account();
		await application.auth.linkProvider(other.user, 'google', { subject: 'g-2', email: other.user.email });
		await application.auth.createPasswordResetToken(other.user);
		let moved: string[] = [];
		await application.auth.mergeUsers(other.user, current.user, { moveData: async (_transaction, from, into) => { moved = [from, into]; } });
		expect(moved).toEqual([String(other.user.id), String(current.user.id)]);
		expect((await application.auth.providersFor(current.user)).map(row => row.provider).sort()).toEqual(['google', 'password']);
		expect((await application.auth.issueTokenForProvider('google', { subject: 'g-2', email: other.user.email }))?.user.id).toBe(current.user.id);
		expect(await application.auth.issueTokenForProvider('password', { email: current.user.email, password })).not.toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: other.user.email, password })).toBeNull();
		expect(await application.requestContext.run(() => application.auth.authenticateToken(other.token))).toBeNull();
		expect(await UserIdentity.query(application.db.knex).where('id', other.user.id).first()).toBeNull();
	});

	it('changes nothing when the app data move fails', async () => {
		const other = await account();
		const current = await account();
		await application.auth.linkProvider(other.user, 'google', { subject: 'g-3', email: other.user.email });
		await expect(application.auth.mergeUsers(other.user, current.user, { moveData: async () => { throw new Error('app move failed'); } })).rejects.toThrow('app move failed');
		expect((await application.auth.providersFor(other.user)).map(row => row.provider).sort()).toEqual(['google', 'password']);
		expect(await application.requestContext.run(() => application.auth.authenticateToken(other.token))).not.toBeNull();
	});
});
