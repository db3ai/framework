import {
	createSign,
	generateKeyPairSync,
	type KeyObject,
	type webcrypto,
} from 'node:crypto';
import {
	describe,
	expect,
	it,
} from 'vitest';
import {
	GOOGLE_AUTH_PROVIDER,
	GoogleAuthProvider,
} from '../../index';

describe('GoogleAuthProvider', () => {
	it('verifies a Google ID token and returns a provider profile', async () => {
		const {
			privateKey,
			publicKey,
		} = generateKeyPairSync('rsa', {
			modulusLength: 2048,
		});
		const publicJwk = publicKey.export({
			format: 'jwk',
		}) as webcrypto.JsonWebKey & {
			kid?: string;
		};

		publicJwk.kid = 'test-key';

		const idToken = signedJwt({
			header: {
				alg: 'RS256',
				kid: 'test-key',
				typ: 'JWT',
			},
			payload: {
				iss: 'https://accounts.google.com',
				aud: 'client-id.apps.googleusercontent.com',
				exp: 1767225600,
				iat: 1767222000,
				sub: 'google-subject-1',
				email: 'user@gmail.com',
				email_verified: true,
				name: 'Steve OBrien',
				picture: 'https://example.com/avatar.png',
				given_name: 'Steve',
				family_name: 'OBrien',
				locale: 'en',
			},
			privateKey,
		});
		const provider = new GoogleAuthProvider({
			clientIds: ['client-id.apps.googleusercontent.com'],
			jwks: [publicJwk],
			now: () => new Date('2026-01-01T00:00:00.000Z'),
		});

		await expect(provider.verify({
			credential: idToken,
			g_csrf_token: 'csrf-token',
			csrfCookie: 'csrf-token',
		})).resolves.toEqual({
			provider: GOOGLE_AUTH_PROVIDER,
			providerUserId: 'google-subject-1',
			email: 'user@gmail.com',
			emailVerifiedAt: new Date('2025-12-31T23:00:00.000Z'),
			name: 'Steve OBrien',
			avatarUrl: 'https://example.com/avatar.png',
			label: 'Google: user@gmail.com',
			profile: {
				emailVerified: true,
				hostedDomain: null,
				givenName: 'Steve',
				familyName: 'OBrien',
				locale: 'en',
			},
		});
	});

	it('rejects a token with the wrong audience', async () => {
		const {
			privateKey,
			publicKey,
		} = generateKeyPairSync('rsa', {
			modulusLength: 2048,
		});
		const publicJwk = publicKey.export({
			format: 'jwk',
		}) as webcrypto.JsonWebKey & {
			kid?: string;
		};

		publicJwk.kid = 'test-key';

		const idToken = signedJwt({
			header: {
				alg: 'RS256',
				kid: 'test-key',
			},
			payload: {
				iss: 'https://accounts.google.com',
				aud: 'other-client-id.apps.googleusercontent.com',
				exp: 1767225600,
				sub: 'google-subject-1',
			},
			privateKey,
		});
		const provider = new GoogleAuthProvider({
			clientIds: ['client-id.apps.googleusercontent.com'],
			jwks: [publicJwk],
			now: () => new Date('2026-01-01T00:00:00.000Z'),
		});

		await expect(provider.verify({
			credential: idToken,
		})).resolves.toBeNull();
	});
});

interface SignedJwtInput {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	privateKey: KeyObject;
}

/**
 * Signs a compact RS256 JWT for provider tests.
 *
 * @param input - JWT header, payload, and private key.
 * @returns Signed compact JWT.
 */
function signedJwt(input: SignedJwtInput): string {
	const signingInput = [
		Buffer.from(JSON.stringify(input.header)).toString('base64url'),
		Buffer.from(JSON.stringify(input.payload)).toString('base64url'),
	].join('.');
	const signer = createSign('RSA-SHA256');

	signer.update(signingInput);
	signer.end();

	return `${signingInput}.${signer.sign(input.privateKey).toString('base64url')}`;
}
