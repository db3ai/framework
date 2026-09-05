import { pathToFileURL } from 'node:url';
import { AuthProvider, AuthToken, PasswordResetToken, UserIdentity, PASSWORD_AUTH_PROVIDER } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { App } from '@db3.ai/app/server';

/**
 * Exercises password registration, sessions, reset and revocation in a disposable database.
 *
 * Requires a test SQL account allowed to create/drop db3_app_test_* databases.
 * This is a service lab, not a public sign-up route. Real routes must validate
 * requests, rate-limit access and choose a secure session transport.
 *
 * @returns Non-secret outcomes; passwords and issued tokens are never logged.
 */
export async function runPasswordAuth() {
	const database = await createGeneratedTestDatabase('auth_guide');
	const application = new App({ db: database.db, config: { auth: { providers: { password: true } } } });
	try {
		// Lab-only schema setup. Use committed migrations in an application.
		await application.db.install(UserIdentity, AuthProvider, AuthToken, PasswordResetToken);
		const credentials = { name: 'Ada', email: 'ada@example.test', password: 'example-only-password-123' };
		const issued = await application.auth.registerWithPassword(credentials, { expiresInMs: 60 * 60 * 1000 });
		const wrongPasswordRejected = await application.auth.issueTokenForProvider(PASSWORD_AUTH_PROVIDER, { ...credentials, password: 'wrong-password' }) === null;
		const signedIn = await application.auth.issueTokenForProvider(PASSWORD_AUTH_PROVIDER, credentials);
		const authenticated = await application.requestContext.run(async () => {
			const user = await application.auth.authenticateToken(issued.token);
			return user?.id === issued.user.id;
		});
		const reset = await application.auth.createPasswordResetToken(issued.user);
		const replacement = { token: reset.token, password: 'replacement-example-password-456' };
		const passwordChanged = Boolean(await application.auth.resetPassword(replacement));
		const usedResetRejected = await application.auth.resetPassword(replacement) === null;
		const oldPasswordRejected = await application.auth.issueTokenForProvider(PASSWORD_AUTH_PROVIDER, credentials) === null;
		const sessions = await application.auth.tokensFor(issued.user);
		for (const session of sessions) await application.auth.revokeToken(issued.user, session.id!);
		const revokedTokenRejected = await application.requestContext.run(async () => await application.auth.authenticateToken(issued.token) === null);
		return { authenticated, signedIn: Boolean(signedIn), wrongPasswordRejected, passwordChanged, usedResetRejected, oldPasswordRejected, revokedTokenRejected };
	} finally {
		try { await application.close(); } finally { await database.destroy(); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runPasswordAuth(), null, 2));
}
