import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { PasswordResetToken } from '@db3.ai/app/auth';

describe('PasswordResetToken', () => {
	it('generates an opaque 256-bit token and stores its deterministic hash', () => {
		const token = PasswordResetToken.generatePlainTextToken();
		const tokenHash = PasswordResetToken.hashToken(token);

		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
		expect(tokenHash).not.toBe(token);
		expect(PasswordResetToken.hashToken('known-reset-token')).toBe(
			'6361166957606c7fee8a59d29cecd21592899e6b3d948b12f268c96c04609da0',
		);
	});

	it('is usable before expiry and expires at the exact boundary', () => {
		const expiresAt = new Date('2026-08-20T12:00:00.000Z');
		const token = new PasswordResetToken({
			userId: 'user-1',
			email: 'steve@example.com',
			tokenHash: PasswordResetToken.hashToken('reset-token'),
			expiresAt,
		});

		expect(token.isExpired(new Date('2026-08-20T11:59:59.999Z'))).toBe(false);
		expect(token.isUsable(new Date('2026-08-20T11:59:59.999Z'))).toBe(true);
		expect(token.isExpired(expiresAt)).toBe(true);
		expect(token.isUsable(expiresAt)).toBe(false);
	});

	it('becomes unusable immediately when marked as used', () => {
		const usedAt = new Date('2026-08-20T10:30:00.000Z');
		const token = new PasswordResetToken({
			userId: 'user-1',
			email: 'steve@example.com',
			tokenHash: PasswordResetToken.hashToken('reset-token'),
			expiresAt: new Date('2026-08-20T12:00:00.000Z'),
		});

		expect(token.isUsed()).toBe(false);
		expect(token.isUsable(new Date('2026-08-20T10:00:00.000Z'))).toBe(true);

		token.markUsed(usedAt);

		expect(token.usedAt).toEqual(usedAt);
		expect(token.isUsed()).toBe(true);
		expect(token.isUsable(new Date('2026-08-20T10:30:00.000Z'))).toBe(false);
	});
});
