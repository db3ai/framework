import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken, UserIdentity } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { App } from '@db3.ai/app/server';

const password = 'original-test-password-123';
const replacement = 'replacement-test-password-456';
let database: GeneratedTestDatabase;
let application: App;
let accountNumber = 0;

/** Creates an independent account and its first real bearer session. */
async function account() {
	return application.auth.registerWithPassword({ name: 'Session test', email: `sessions-${++accountNumber}@example.test`, password });
}

/** Verifies a token through a fresh request, as another device would use it. */
async function authenticate(token: string) {
	return application.requestContext.run(() => application.auth.authenticateToken(token));
}

describe('account-wide session revocation', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('auth_revocation');
		application = new App({ db: database.db });
		await application.db.install(UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken);
	});

	afterAll(async () => {
		try { await application?.close(); } finally { await database?.destroy(); }
	});

	it('revokes all devices and cached authentication while preserving other accounts and future sign-ins', async () => {
		const owner = await account();
		const second = await application.auth.createToken(owner.user);
		const other = await account();
		await application.requestContext.run(async () => {
			await application.auth.authenticateToken(second.token);
			await application.auth.authenticateToken(owner.token);
			expect(await application.auth.revokeAllTokens(owner.user)).toBe(2);
			expect(application.auth.user).toBeNull();
			expect(application.auth.token).toBeNull();
			expect(await application.auth.authenticateToken(owner.token)).toBeNull();
			expect(await application.auth.authenticateToken(second.token)).toBeNull();
		});
		expect(await authenticate(owner.token)).toBeNull();
		expect(await authenticate(second.token)).toBeNull();
		expect((await authenticate(other.token))?.id).toBe(other.user.id);
		expect(await application.auth.tokensFor(owner.user)).toEqual([]);
		expect(await application.auth.revokeAllTokens(owner.user)).toBe(0);
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password })).not.toBeNull();
	});

	it('resets a password, revokes every device and invalidates all older recovery links', async () => {
		const owner = await account();
		const second = await application.auth.createToken(owner.user);
		const earlier = await application.auth.createPasswordResetToken(owner.user);
		const reset = await application.auth.createPasswordResetToken(owner.user);
		const other = await account();
		const otherReset = await application.auth.createPasswordResetToken(other.user);
		expect((await application.auth.resetPassword({ email: owner.user.email, token: reset.token, password: replacement }))?.id).toBe(owner.user.id);
		for (const token of [owner.token, second.token]) expect(await authenticate(token)).toBeNull();
		for (const token of [earlier.token, reset.token]) expect(await application.auth.resetPassword({ token, password })).toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password })).toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password: replacement })).not.toBeNull();
		expect(await authenticate(other.token)).not.toBeNull();
		expect(await application.auth.resetPassword({ token: otherReset.token, password: replacement })).not.toBeNull();
	});

	it('preserves credentials, sessions and recovery links after invalid input', async () => {
		const owner = await account();
		const reset = await application.auth.createPasswordResetToken(owner.user);
		const expired = await application.auth.createPasswordResetToken(owner.user, { expiresAt: new Date('2020-01-01T00:00:00Z') });
		expect(await application.auth.resetPassword({ token: 'invalid', password: replacement })).toBeNull();
		expect(await application.auth.resetPassword({ token: expired.token, password: replacement })).toBeNull();
		expect(await application.auth.resetPassword({ token: reset.token, email: 'different@example.test', password: replacement })).toBeNull();
		await expect(application.auth.resetPassword({ token: reset.token, password: 'short' })).rejects.toThrow();
		expect(await authenticate(owner.token)).not.toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password })).not.toBeNull();
		expect(await application.auth.resetPassword({ token: reset.token, password: replacement })).not.toBeNull();
	});

	it.each([true, false])('allows only one concurrent redemption, same link: %s', async sameLink => {
		const owner = await account();
		const first = await application.auth.createPasswordResetToken(owner.user);
		const second = sameLink ? first : await application.auth.createPasswordResetToken(owner.user);
		const results = await Promise.all([first, second].map(reset => application.auth.resetPassword({
			token: reset.token, email: owner.user.email, password: replacement,
		})));
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(await authenticate(owner.token)).toBeNull();
	});

	it('changes passwords atomically and rejects an incorrect current password without revocation', async () => {
		const owner = await account();
		const second = await application.auth.createToken(owner.user);
		const reset = await application.auth.createPasswordResetToken(owner.user);
		expect(await application.auth.changePasswordProvider(owner.user, 'incorrect', replacement)).toBe(false);
		await expect(application.auth.changePasswordProvider(owner.user, password, 'short')).rejects.toThrow();
		expect(await authenticate(owner.token)).not.toBeNull();
		expect(await application.auth.changePasswordProvider(owner.user, password, replacement)).toBe(true);
		for (const token of [owner.token, second.token]) expect(await authenticate(token)).toBeNull();
		expect(await application.auth.resetPassword({ token: reset.token, password })).toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password: replacement })).not.toBeNull();
	});

	it('rolls back password and recovery writes if session revocation fails in SQL', async () => {
		const owner = await account();
		const reset = await application.auth.createPasswordResetToken(owner.user);
		await database.db.raw("CREATE TRIGGER reject_session_revocation BEFORE UPDATE ON auth_tokens FOR EACH ROW BEGIN IF NEW.revoked_at IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test revocation failure'; END IF; END");
		try {
			await expect(application.auth.resetPassword({ token: reset.token, password: replacement })).rejects.toThrow('Test revocation failure');
		} finally {
			await database.db.raw('DROP TRIGGER reject_session_revocation');
		}
		expect(await authenticate(owner.token)).not.toBeNull();
		expect(await application.auth.issueTokenForProvider('password', { email: owner.user.email, password })).not.toBeNull();
		expect(await application.auth.resetPassword({ token: reset.token, password: replacement })).not.toBeNull();
	});
});
