import {
	createPublicKey,
	createVerify,
} from 'node:crypto';
import type { webcrypto } from 'node:crypto';
import type * as auth from '../contracts';
import type { UserIdentity } from '../UserIdentity';

export const GOOGLE_AUTH_PROVIDER = 'google';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set([
	'accounts.google.com',
	'https://accounts.google.com',
]);

export type GoogleJsonWebKey = webcrypto.JsonWebKey & {
	kid?: string;
};
type Fetch = typeof fetch;

interface GoogleJwks {
	keys?: GoogleJsonWebKey[];
}

interface GoogleJwtHeader {
	alg?: unknown;
	kid?: unknown;
	typ?: unknown;
}

interface GoogleIdTokenPayload {
	iss?: unknown;
	aud?: unknown;
	exp?: unknown;
	iat?: unknown;
	sub?: unknown;
	email?: unknown;
	email_verified?: unknown;
	name?: unknown;
	picture?: unknown;
	given_name?: unknown;
	family_name?: unknown;
	locale?: unknown;
	hd?: unknown;
}

/**
 * Input accepted by the Google auth provider.
 */
export interface GoogleAuthProviderInput {
	/**
	 * Google Identity Services credential field containing the ID token.
	 */
	credential?: string;

	/**
	 * Alternative explicit ID-token field for non-GIS clients.
	 */
	idToken?: string;

	/**
	 * CSRF token submitted in the request body by Google Identity Services.
	 */
	g_csrf_token?: string;

	/**
	 * Alternative explicit CSRF token field.
	 */
	csrfToken?: string;

	/**
	 * CSRF token read from the request cookie by the route.
	 */
	csrfCookie?: string;
}

/**
 * Runtime options for Google ID-token verification.
 */
export interface GoogleAuthProviderOptions {
	/**
	 * Single Google OAuth web client id.
	 */
	clientId?: string;

	/**
	 * Accepted Google OAuth web client ids.
	 */
	clientIds?: string[];

	/**
	 * Optional Google Workspace hosted domain restriction.
	 */
	hostedDomain?: string;

	/**
	 * JWK endpoint used to fetch Google signing keys.
	 */
	jwksUrl?: string;

	/**
	 * Fetch implementation, injectable for tests.
	 */
	fetch?: Fetch;

	/**
	 * Static signing keys, injectable for deterministic tests.
	 */
	jwks?: GoogleJsonWebKey[];

	/**
	 * Clock skew allowance in seconds.
	 */
	clockSkewSeconds?: number;

	/**
	 * Time source used for expiry checks.
	 */
	now?: () => Date | number;
}

/**
 * Provider driver for Google Sign-In ID tokens.
 *
 * This provider verifies a Google-signed ID token and translates the verified
 * claims into the framework's normalized provider profile. It intentionally
 * does not store OAuth access or refresh tokens.
 */
export class GoogleAuthProvider<TIdentity extends UserIdentity = UserIdentity> implements auth.AuthProviderDriver<GoogleAuthProviderInput, TIdentity> {
	readonly provider = GOOGLE_AUTH_PROVIDER;
	private readonly clientIds: string[];
	private readonly hostedDomain: string | null;
	private readonly jwksUrl: string;
	private readonly fetcher: Fetch;
	private readonly staticJwks: GoogleJsonWebKey[] | null;
	private readonly clockSkewSeconds: number;
	private readonly now: () => Date | number;
	private jwksCache: {
		expiresAt: number;
		keys: GoogleJsonWebKey[];
	} | null = null;

	/**
	 * Creates a Google auth provider.
	 *
	 * @param options - Google provider verification options.
	 */
	constructor(options: GoogleAuthProviderOptions = {}) {
		this.clientIds = normalizeStringArray([
			...(options.clientIds ?? []),
			options.clientId,
		]);
		this.hostedDomain = normalizeOptionalString(options.hostedDomain);
		this.jwksUrl = options.jwksUrl ?? GOOGLE_JWKS_URL;
		this.fetcher = options.fetch ?? fetch;
		this.staticJwks = options.jwks ?? null;
		this.clockSkewSeconds = options.clockSkewSeconds ?? 60;
		this.now = options.now ?? (() => new Date());
	}

	/**
	 * Verifies a Google ID token and returns the normalized provider profile.
	 *
	 * @param input - Google credential payload.
	 * @returns Normalized Google provider profile, or null when verification fails.
	 */
	async verify(input: GoogleAuthProviderInput): Promise<auth.AuthProviderProfile | null> {
		if (!isGoogleAuthProviderInput(input)) return null;
		if (!this.csrfTokensMatch(input)) return null;

		const idToken = input.credential ?? input.idToken;

		if (!idToken) return null;

		const verified = await this.verifyIdToken(idToken);

		if (!verified) return null;

		const email = normalizeOptionalString(verified.payload.email);
		const emailVerified = verified.payload.email_verified === true || verified.payload.email_verified === 'true';
		const hostedDomain = normalizeOptionalString(verified.payload.hd);
		const issuedAt = typeof verified.payload.iat === 'number'
			? new Date(verified.payload.iat * 1000)
			: new Date(this.nowMs());

		return {
			provider: this.provider,
			providerUserId: verified.payload.sub,
			email,
			emailVerifiedAt: googleIsAuthoritativeForEmail(email, emailVerified, hostedDomain)
				? issuedAt
				: null,
			name: normalizeOptionalString(verified.payload.name),
			avatarUrl: normalizeOptionalString(verified.payload.picture),
			label: email ? `Google: ${email}` : 'Google',
			profile: {
				emailVerified,
				hostedDomain,
				givenName: normalizeOptionalString(verified.payload.given_name),
				familyName: normalizeOptionalString(verified.payload.family_name),
				locale: normalizeOptionalString(verified.payload.locale),
			},
		};
	}

	/**
	 * Checks whether supplied CSRF values match when either value is present.
	 *
	 * @param input - Google credential payload.
	 * @returns True when CSRF values are absent or exactly match.
	 */
	private csrfTokensMatch(input: GoogleAuthProviderInput): boolean {
		const bodyToken = input.g_csrf_token ?? input.csrfToken;
		const cookieToken = input.csrfCookie;

		if (!bodyToken && !cookieToken) return true;

		return Boolean(bodyToken && cookieToken && bodyToken === cookieToken);
	}

	/**
	 * Verifies a compact JWT from Google.
	 *
	 * @param idToken - Compact Google ID token.
	 * @returns Verified header and payload, or null when invalid.
	 */
	private async verifyIdToken(idToken: string): Promise<{
		header: GoogleJwtHeader;
		payload: GoogleIdTokenPayload & {
			sub: string;
		};
	} | null> {
		if (this.clientIds.length === 0) {
			throw new Error('Google auth provider requires at least one configured client id.');
		}

		const parts = idToken.split('.');

		if (parts.length !== 3) return null;

		const [encodedHeader, encodedPayload, encodedSignature] = parts;
		const header = decodeJwtPart<GoogleJwtHeader>(encodedHeader);
		const payload = decodeJwtPart<GoogleIdTokenPayload>(encodedPayload);

		if (!header || !payload) return null;
		if (header.alg !== 'RS256') return null;
		if (typeof header.kid !== 'string' || !header.kid) return null;
		if (!this.claimsAreValid(payload)) return null;

		const keys = await this.jwks();
		const key = keys.find(candidate => candidate.kid === header.kid);

		if (!key) return null;

		const verified = verifyJwtSignature(
			`${encodedHeader}.${encodedPayload}`,
			encodedSignature,
			key,
		);

		if (!verified) return null;

		return {
			header,
			payload: payload as GoogleIdTokenPayload & {
				sub: string;
			},
		};
	}

	/**
	 * Validates the required Google ID-token claims.
	 *
	 * @param payload - Decoded JWT payload.
	 * @returns True when required claims are acceptable.
	 */
	private claimsAreValid(payload: GoogleIdTokenPayload): boolean {
		if (typeof payload.sub !== 'string' || !payload.sub) return false;
		if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) return false;
		if (!audienceMatches(payload.aud, this.clientIds)) return false;
		if (typeof payload.exp !== 'number') return false;
		if (payload.exp + this.clockSkewSeconds < Math.floor(this.nowMs() / 1000)) return false;

		const hostedDomain = normalizeOptionalString(payload.hd);

		if (this.hostedDomain && hostedDomain !== this.hostedDomain) {
			return false;
		}

		return true;
	}

	/**
	 * Returns Google JWKs, using cache-control when keys are fetched remotely.
	 *
	 * @returns Google signing keys.
	 */
	private async jwks(): Promise<GoogleJsonWebKey[]> {
		if (this.staticJwks) return this.staticJwks;

		const now = this.nowMs();

		if (this.jwksCache && this.jwksCache.expiresAt > now) {
			return this.jwksCache.keys;
		}

		const response = await this.fetcher(this.jwksUrl);

		if (!response.ok) {
			throw new Error(`Unable to fetch Google JWKs: ${response.status} ${response.statusText}`);
		}

		const body = await response.json() as GoogleJwks;
		const keys = Array.isArray(body.keys) ? body.keys : [];
		const maxAgeSeconds = cacheControlMaxAge(response.headers.get('cache-control')) ?? 3600;

		this.jwksCache = {
			expiresAt: now + maxAgeSeconds * 1000,
			keys,
		};

		return keys;
	}

	/**
	 * Returns the current time in milliseconds.
	 *
	 * @returns Current epoch milliseconds.
	 */
	private nowMs(): number {
		const value = this.now();

		return value instanceof Date ? value.getTime() : value;
	}
}

/**
 * Checks whether a value looks like Google provider input.
 *
 * @param value - Unknown input value.
 * @returns True when the value can be inspected as provider input.
 */
function isGoogleAuthProviderInput(value: unknown): value is GoogleAuthProviderInput {
	return typeof value === 'object' && value !== null;
}

/**
 * Decodes a base64url-encoded JWT part as JSON.
 *
 * @param part - Encoded JWT header or payload.
 * @returns Parsed JSON object, or null when invalid.
 */
function decodeJwtPart<TValue extends object>(part: string): TValue | null {
	try {
		const json = Buffer.from(part, 'base64url').toString('utf8');
		const parsed = JSON.parse(json) as unknown;

		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? parsed as TValue
			: null;
	} catch {
		return null;
	}
}

/**
 * Verifies an RS256 JWT signature against a JWK.
 *
 * @param signingInput - Encoded JWT header and payload.
 * @param encodedSignature - Base64url-encoded signature.
 * @param key - JWK selected by JWT key id.
 * @returns True when the signature is valid.
 */
function verifyJwtSignature(
	signingInput: string,
	encodedSignature: string,
	key: GoogleJsonWebKey,
): boolean {
	try {
		const verifier = createVerify('RSA-SHA256');

		verifier.update(signingInput);
		verifier.end();

		return verifier.verify(
			createPublicKey({
				key,
				format: 'jwk',
			}),
			Buffer.from(encodedSignature, 'base64url'),
		);
	} catch {
		return false;
	}
}

/**
 * Checks whether a token audience matches one of the configured client ids.
 *
 * @param audience - JWT audience claim.
 * @param clientIds - Accepted client ids.
 * @returns True when one audience is accepted.
 */
function audienceMatches(audience: unknown, clientIds: string[]): boolean {
	if (typeof audience === 'string') return clientIds.includes(audience);
	if (Array.isArray(audience)) return audience.some(value => {
		return typeof value === 'string' && clientIds.includes(value);
	});

	return false;
}

/**
 * Parses a cache-control max-age value.
 *
 * @param header - Cache-Control header value.
 * @returns Max age in seconds, or null when absent.
 */
function cacheControlMaxAge(header: string | null): number | null {
	if (!header) return null;

	const match = header.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);

	return match ? Number(match[1]) : null;
}

/**
 * Normalizes a list of optional strings.
 *
 * @param values - String values to normalize.
 * @returns Trimmed non-empty strings.
 */
function normalizeStringArray(values: Array<string | undefined>): string[] {
	return values
		.map(value => normalizeOptionalString(value))
		.filter((value): value is string => Boolean(value));
}

/**
 * Normalizes an optional string.
 *
 * @param value - Unknown string value.
 * @returns Trimmed string, or null when absent.
 */
function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const normalized = value.trim();

	return normalized || null;
}

/**
 * Determines whether Google is authoritative for an email claim.
 *
 * @param email - Email claim.
 * @param emailVerified - Google email_verified claim.
 * @param hostedDomain - Google hosted domain claim.
 * @returns True when Google can be treated as current email owner.
 */
function googleIsAuthoritativeForEmail(
	email: string | null,
	emailVerified: boolean,
	hostedDomain: string | null,
): boolean {
	if (!emailVerified || !email) return false;
	if (email.toLowerCase().endsWith('@gmail.com')) return true;
	return Boolean(hostedDomain);
}
