import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken, UserIdentity } from '../index';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { App } from '../../server';

let database: GeneratedTestDatabase;
let application: App;

describe('auth request input and isolated fallback scopes', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('auth_security');
		application = new App({ db: database.db });
		await application.db.install(UserIdentity, AuthProvider, PasswordLoginAttempt, AuthToken, PasswordResetToken);
	});

	afterAll(async () => {
		try { await application?.close(); } finally { await database?.destroy(); }
	});

	it('preserves ordinary registration while ignoring guarded account state', async () => {
		const issued = await application.auth.registerWithPassword({
			name: 'Registered person', email: 'guarded-registration@example.test', password: 'safe-registration-password-123',
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', emailVerifiedAt: new Date('2000-01-01'), rememberToken: 'forged', createdAt: new Date('2000-01-01'),
		});
		expect(issued.user.name).toBe('Registered person');
		expect(issued.user.id).not.toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
		expect(issued.user.emailVerifiedAt).toBeNull();
		expect(issued.user.rememberToken).toBeNull();
		expect(issued.user.createdAt?.getUTCFullYear()).not.toBe(2000);
		expect(await application.auth.authenticateToken(issued.token)).not.toBeNull();
	});

	it('keeps overlapping asynchronous user scopes isolated without a request context', async () => {
		const alice = await UserIdentity.create({ name: 'Alice', email: 'scope-alice@example.test' }).save();
		const bob = await UserIdentity.create({ name: 'Bob', email: 'scope-bob@example.test' }).save();
		const auth = new Auth({ db: application.db });
		const first = auth.runWithUser(alice, async () => {
			await Promise.resolve();
			expect(auth.user?.id).toBe(alice.id);
			expect(auth.token).toBeNull();
		});
		const second = auth.runWithUser(bob, async () => {
			await first;
			expect(auth.user?.id).toBe(bob.id);
		});
		await Promise.all([first, second]);
		expect(auth.user).toBeNull();
		expect(auth.token).toBeNull();
	});
});
