import {
	describe,
	expect,
	it,
} from 'vitest';
import {
	AuthProvider,
	PASSWORD_AUTH_PROVIDER,
} from '../index';
import { defaultPasswordHash } from '../passwordHash';
import { Database } from '../../db';

describe('AuthProvider', () => {
	it('stores password credentials and provider metadata outside the user table', async () => {
		const provider = new AuthProvider({
			userId: 'user-1',
			provider: PASSWORD_AUTH_PROVIDER,
			providerUserId: 'steve@example.com',
			email: 'STEVE@EXAMPLE.COM',
			password: 'correct horse battery',
		});

		expect(provider.password).toBeNull();
		expect(provider.email).toBe('steve@example.com');
		expect(provider.isPasswordProvider()).toBe(true);

		const row = await provider.getDataForDb({
			isInsert: true,
		});

		expect(row).toMatchObject({
			user_id: 'user-1',
			provider: PASSWORD_AUTH_PROVIDER,
			provider_user_id: 'steve@example.com',
			email: 'steve@example.com',
		});
		expect(row.password).toEqual(expect.stringMatching(/^scrypt\$1\$/));
		await expect(
			defaultPasswordHash.verify('correct horse battery', row.password as string),
		).resolves.toBe(true);
	});

	it('defines provider uniqueness indexes for account management', () => {
		const schema = Database.getSchema(AuthProvider);

		expect(schema.indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'auth_providers_user_id_index',
					columns: ['user_id'],
				}),
				expect.objectContaining({
					name: 'auth_providers_user_provider_unique',
					columns: ['user_id', 'provider'],
					unique: true,
				}),
				expect.objectContaining({
					name: 'auth_providers_provider_user_id_unique',
					columns: ['provider', 'provider_user_id'],
					unique: true,
				}),
			]),
		);
	});

	it('returns a settings-safe provider summary', () => {
		const provider = new AuthProvider({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			userId: 'user-1',
			provider: 'google',
			providerUserId: 'google-user-1',
			label: 'Google: steve@example.com',
			email: 'steve@example.com',
			avatarUrl: 'https://example.com/avatar.png',
			profile: {
				locale: 'en',
			},
			lastLoginAt: new Date('2026-07-11T12:00:00.000Z'),
			createdAt: new Date('2026-07-10T12:00:00.000Z'),
		});

		expect(provider.toSummary()).toEqual({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			provider: 'google',
			label: 'Google: steve@example.com',
			email: 'steve@example.com',
			avatarUrl: 'https://example.com/avatar.png',
			lastLoginAt: '2026-07-11T12:00:00.000Z',
			createdAt: '2026-07-10T12:00:00.000Z',
		});
		expect(provider.toSummary()).not.toHaveProperty('password');
		expect(provider.toSummary()).not.toHaveProperty('providerUserId');
		expect(provider.toSummary()).not.toHaveProperty('profile');
	});
});
