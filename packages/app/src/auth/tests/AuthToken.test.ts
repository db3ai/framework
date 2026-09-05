import { describe, expect, it } from 'vitest';
import { AuthToken } from '../index';
import { Database } from '../../db';

describe('AuthToken sessions', () => {
	it('serializes safe session metadata without exposing credential material', () => {
		const token = new AuthToken({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			userId: 'user-1',
			tokenHash: 'secret-token-hash',
			name: 'Chrome on macOS',
			ipAddress: '203.0.113.10',
			userAgent: 'private raw user agent',
			browser: 'Chrome',
			operatingSystem: 'macOS',
			device: 'Desktop',
			createdAt: new Date('2026-07-11T12:00:00.000Z'),
			lastUsedAt: new Date('2026-07-11T12:30:00.000Z'),
		});

		expect(token.toSessionData()).toEqual({
			id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
			name: 'Chrome on macOS',
			ipAddress: '203.0.113.10',
			browser: 'Chrome',
			operatingSystem: 'macOS',
			device: 'Desktop',
			expiresAt: null,
			lastUsedAt: '2026-07-11T12:30:00.000Z',
			createdAt: '2026-07-11T12:00:00.000Z',
		});
		expect(token.toJSON()).not.toHaveProperty('tokenHash');
		expect(token.toJSON()).not.toHaveProperty('userAgent');
	});

	it('becomes inactive immediately after revocation', () => {
		const token = new AuthToken({
			userId: 'user-1',
			tokenHash: 'secret-token-hash',
		});

		expect(token.isActive()).toBe(true);

		token.revoke(new Date('2026-07-11T12:00:00.000Z'));

		expect(token.isActive()).toBe(false);
		expect(token.revokedAt).toEqual(new Date('2026-07-11T12:00:00.000Z'));
	});

	it('indexes sessions by their owning user', () => {
		const schema = Database.getSchema(AuthToken);

		expect(schema.indexes).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: 'auth_tokens_user_id_index',
				columns: ['user_id'],
			}),
		]));
	});
});
