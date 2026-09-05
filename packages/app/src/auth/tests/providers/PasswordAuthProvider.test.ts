import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	AuthProvider,
	PASSWORD_AUTH_PROVIDER,
	PasswordAuthProvider,
} from '../../index';
import { defaultPasswordHash } from '../../passwordHash';

describe('PasswordAuthProvider', () => {
	it('verifies password credentials against a password provider row', async () => {
		const hash = await defaultPasswordHash.hash('correct horse battery');
		const provider = new AuthProvider({
			id: 'provider-1',
			user_id: 'user-1',
			provider: PASSWORD_AUTH_PROVIDER,
			provider_user_id: 'steve@example.com',
			email: 'steve@example.com',
			password: hash,
		}, {
			fromDb: true,
		});
		const query = {
			where: vi.fn(() => query),
			first: vi.fn(async () => provider),
		};
		const providerModel = {
			query: vi.fn(() => query),
		};
		const driver = new PasswordAuthProvider({
			identityModel: {
				identityField: 'email',
				primaryKey: 'id',
			} as any,
			providerModel: providerModel as any,
			passwordHash: defaultPasswordHash,
		});

		const profile = await driver.verify({
			email: 'STEVE@EXAMPLE.COM',
			password: 'correct horse battery',
		});

		expect(profile).toMatchObject({
			provider: PASSWORD_AUTH_PROVIDER,
			providerUserId: 'steve@example.com',
			email: 'steve@example.com',
		});
		expect(providerModel.query).toHaveBeenCalledWith();
		expect(query.where).toHaveBeenCalledWith('provider', PASSWORD_AUTH_PROVIDER);
		expect(query.where).toHaveBeenCalledWith('providerUserId', 'steve@example.com');
	});

	it('rejects invalid password credentials', async () => {
		const hash = await defaultPasswordHash.hash('correct horse battery');
		const provider = new AuthProvider({
			id: 'provider-1',
			user_id: 'user-1',
			provider: PASSWORD_AUTH_PROVIDER,
			provider_user_id: 'steve@example.com',
			email: 'steve@example.com',
			password: hash,
		}, {
			fromDb: true,
		});
		const query = {
			where: vi.fn(() => query),
			first: vi.fn(async () => provider),
		};
		const driver = new PasswordAuthProvider({
			identityModel: {
				identityField: 'email',
				primaryKey: 'id',
			} as any,
			providerModel: {
				query: vi.fn(() => query),
			} as any,
			passwordHash: defaultPasswordHash,
		});

		await expect(driver.verify({
			email: 'steve@example.com',
			password: 'wrong password',
		})).resolves.toBeNull();
	});
});
