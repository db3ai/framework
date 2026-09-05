import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	Auth,
	AuthProviderNotConfiguredError,
	GOOGLE_AUTH_PROVIDER,
	PASSWORD_AUTH_PROVIDER,
	type AuthOptions,
} from '../index';
import { Config } from '../../config';
import { RequestContext } from '../../server';

describe('Auth', () => {
	it('uses the configured auth provider registry', async () => {
		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
			providers: {
				google: {
					provider: 'google',
					async verify() {
						return null;
					},
				},
			},
		} as unknown as AuthOptions);

		expect(auth.configuredProviders()).toEqual(['google']);
		await expect(auth.authenticatePassword({
			email: 'steve@example.com',
			password: 'correct horse battery',
		})).rejects.toBeInstanceOf(AuthProviderNotConfiguredError);
	});

	it('enables the password auth provider by default', () => {
		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
		} as unknown as AuthOptions);

		expect(auth.configuredProviders()).toEqual([PASSWORD_AUTH_PROVIDER]);
	});

	it('resolves auth providers from the app config repository', () => {
		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
			config: new Config({
				auth: {
					providers: {
						[PASSWORD_AUTH_PROVIDER]: {
							driver: PASSWORD_AUTH_PROVIDER,
						},
						[GOOGLE_AUTH_PROVIDER]: {
							driver: GOOGLE_AUTH_PROVIDER,
							clientIds: ['client-id.apps.googleusercontent.com'],
						},
					},
				},
			}),
		} as unknown as AuthOptions);

		expect(auth.configuredProviders()).toEqual([
			PASSWORD_AUTH_PROVIDER,
			GOOGLE_AUTH_PROVIDER,
		]);
	});

	it('creates password reset tokens for an already-loaded identity', async () => {
		const expiresAt = new Date('2026-01-01T00:00:00.000Z');
		const createdTokens: Array<{
			attributes: Record<string, unknown>;
			options: Record<string, unknown>;
			save: ReturnType<typeof vi.fn>;
		}> = [];
		const userValues: Record<string, unknown> = {
			id: 'user-1',
			email: 'steve@example.com',
		};
		const user = {
			get: vi.fn((field: string) => userValues[field]),
		};
		const identityModel = {
			primaryKey: 'id',
			identityField: 'email',
			query: vi.fn(),
		};

		class FakePasswordResetToken {
			static generatePlainTextToken = vi.fn(() => 'plain-reset-token');
			static hashToken = vi.fn((token: string) => `hash:${token}`);

			readonly attributes: Record<string, unknown>;
			readonly options: Record<string, unknown>;
			readonly save = vi.fn(async () => undefined);

			constructor(
				attributes: Record<string, unknown>,
				options: Record<string, unknown>,
			) {
				this.attributes = attributes;
				this.options = options;
				createdTokens.push(this);
			}
		}

		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
			identityModel,
			passwordResetTokenModel: FakePasswordResetToken,
		} as unknown as AuthOptions);

		const issued = await auth.createPasswordResetToken(user as any, {
			expiresAt,
		});

		expect(identityModel.query).not.toHaveBeenCalled();
		expect(FakePasswordResetToken.generatePlainTextToken).toHaveBeenCalledTimes(1);
		expect(FakePasswordResetToken.hashToken).toHaveBeenCalledWith('plain-reset-token');
		expect(createdTokens).toHaveLength(1);
		expect(createdTokens[0].attributes).toEqual({
			userId: 'user-1',
			email: 'steve@example.com',
			tokenHash: 'hash:plain-reset-token',
			expiresAt,
		});
		expect(createdTokens[0].save).toHaveBeenCalledTimes(1);
		expect(issued).toEqual({
			type: 'password_reset',
			token: 'plain-reset-token',
			expiresAt,
			user,
		});
	});

	it('memoizes bearer-token authentication inside the active request context', async () => {
		const requestContext = new RequestContext();
		const user = {
			id: 'user-1',
			lastLoginAt: null as Date | null,
			save: vi.fn(async () => undefined),
			setDb: vi.fn(),
		};
		const tokenRecord = {
			userId: 'user-1',
			isActive: vi.fn(() => true),
			markUsed: vi.fn(),
			save: vi.fn(async () => undefined),
		};
		const tokenModel = {
			hashToken: vi.fn((token: string) => `hash:${token}`),
			query: vi.fn(() => ({
				where: vi.fn(() => ({
					first: vi.fn(async () => tokenRecord),
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
			requestContext,
			tokenModel,
		} as unknown as AuthOptions);

		await requestContext.run(async () => {
			const first = await auth.authenticateToken('secret-token');
			const second = await auth.authenticateToken('secret-token');

			expect(second).toBe(first);
			expect(auth.user).toBe(user);
			expect(auth.token).toBe(tokenRecord);
		});

		expect(tokenModel.query).toHaveBeenCalledTimes(1);
		expect(identityModel.findByPk).toHaveBeenCalledTimes(1);
		expect(tokenRecord.markUsed).toHaveBeenCalledTimes(1);
		expect(tokenRecord.save).toHaveBeenCalledTimes(1);
		expect(user.save).toHaveBeenCalledTimes(1);
	});

	it('revokes only active tokens owned by the supplied user', async () => {
		const tokenRecord = {
			isActive: vi.fn(() => true),
			revoke: vi.fn(),
			save: vi.fn(async () => undefined),
		};
		const secondWhere = vi.fn(() => ({
			first: vi.fn(async () => tokenRecord),
		}));
		const firstWhere = vi.fn(() => ({
			where: secondWhere,
		}));
		const tokenModel = {
			query: vi.fn(() => ({
				where: firstWhere,
			})),
		};
		const user = {
			get: vi.fn((field: string) => field === 'id' ? 'user-1' : null),
		};
		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
			tokenModel,
		} as unknown as AuthOptions);

		await expect(auth.revokeToken(user as any, 'token-1')).resolves.toBe(true);
		expect(firstWhere).toHaveBeenCalledWith('id', 'token-1');
		expect(secondWhere).toHaveBeenCalledWith('userId', 'user-1');
		expect(tokenRecord.revoke).toHaveBeenCalledTimes(1);
		expect(tokenRecord.save).toHaveBeenCalledTimes(1);
	});

	it('rejects a revoked bearer token before loading its user', async () => {
		const tokenRecord = {
			isActive: vi.fn(() => false),
		};
		const tokenModel = {
			hashToken: vi.fn(() => 'hash:revoked-token'),
			query: vi.fn(() => ({
				where: vi.fn(() => ({
					first: vi.fn(async () => tokenRecord),
				})),
			})),
		};
		const identityModel = {
			primaryKey: 'id',
			identityField: 'email',
			findByPk: vi.fn(),
		};
		const auth = new Auth({
			db: {
				knex: vi.fn(),
			},
			identityModel,
			tokenModel,
		} as unknown as AuthOptions);

		await expect(auth.authenticateToken('revoked-token')).resolves.toBeNull();
		expect(identityModel.findByPk).not.toHaveBeenCalled();
		expect(auth.user).toBeNull();
		expect(auth.token).toBeNull();
	});
});
