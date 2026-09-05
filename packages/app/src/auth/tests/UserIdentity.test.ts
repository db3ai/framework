import { describe, expect, it, vi } from 'vitest';
import { Auth, type AuthOptions, UserIdentity } from '../index';

describe('UserIdentity avatar', () => {
	it('persists and serializes the account avatar URL', async () => {
		const user = new UserIdentity({
			name: 'Steve OBrien',
			email: 'steve@example.com',
			avatarUrl: 'https://example.com/avatar.png',
		});

		await expect(user.getDataForDb({
			isInsert: true,
		})).resolves.toMatchObject({
			avatar_url: 'https://example.com/avatar.png',
		});
		expect(user.toJSON()).toMatchObject({
			avatarUrl: 'https://example.com/avatar.png',
		});
	});

	it('backfills a missing account avatar from a verified provider', async () => {
		const harness = existingProviderHarness(null);

		await expect(harness.auth.authenticateProvider('google', {})).resolves.toBe(harness.user);
		expect(harness.user.avatarUrl).toBe('https://example.com/google-avatar.png');
		expect(harness.user.save).toHaveBeenCalledTimes(1);
	});

	it('preserves an account avatar when a provider reports another image', async () => {
		const harness = existingProviderHarness('https://example.com/custom-avatar.png');

		await expect(harness.auth.authenticateProvider('google', {})).resolves.toBe(harness.user);
		expect(harness.user.avatarUrl).toBe('https://example.com/custom-avatar.png');
	});
});

/**
 * Creates an auth harness for an account with an existing Google provider.
 *
 * @param avatarUrl - Existing account avatar value.
 * @returns Auth service and observable account test double.
 */
function existingProviderHarness(avatarUrl: string | null): {
	auth: Auth;
	user: {
		avatarUrl: string | null;
		lastLoginAt: Date | null;
		get(field: string): unknown;
		save: ReturnType<typeof vi.fn>;
		setDb: ReturnType<typeof vi.fn>;
	};
} {
	const user = {
		avatarUrl,
		lastLoginAt: null as Date | null,
		get: (field: string): unknown => field === 'id' ? 'user-1' : null,
		save: vi.fn(async () => undefined),
		setDb: vi.fn(),
	};
	const providerRecord = {
		userId: 'user-1',
		applyProfile: vi.fn(),
		markUsed: vi.fn(),
		save: vi.fn(async () => undefined),
	};
	const providerModel = {
		query: vi.fn(() => ({
			where: vi.fn(() => ({
				where: vi.fn(() => ({
					first: vi.fn(async () => providerRecord),
				})),
			})),
		})),
	};
	const identityModel = {
		primaryKey: 'id',
		identityField: 'email',
		findByPk: vi.fn(async () => user),
	};
	const auth = new Auth({
		db: {
			knex: vi.fn(),
		},
		identityModel,
		providerModel,
		providers: {
			google: {
				provider: 'google',
				async verify() {
					return {
						provider: 'google',
						providerUserId: 'google-user-1',
						email: 'steve@example.com',
						avatarUrl: 'https://example.com/google-avatar.png',
					};
				},
			},
		},
	} as unknown as AuthOptions);

	return {
		auth,
		user,
	};
}
