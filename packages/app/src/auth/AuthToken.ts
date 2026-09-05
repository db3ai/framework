import {
	createHash,
	randomBytes,
} from 'node:crypto';

import {
	ActiveRecord,
	type FieldBuilder,
} from '../db';

export interface CreateAuthTokenOptions {
	/** Human-friendly session name displayed to the user. */
	name?: string;
	/** Absolute token expiry. Null creates a non-expiring token. */
	expiresAt?: Date | null;
	/** Latest client IP address observed for the session. */
	ipAddress?: string | null;
	/** Raw user-agent string captured when the session was created. */
	userAgent?: string | null;
	/** Parsed browser name, such as Chrome or Mobile Safari. */
	browser?: string | null;
	/** Parsed operating-system name, such as macOS or iOS. */
	operatingSystem?: string | null;
	/** Parsed device label, such as iPhone or Desktop. */
	device?: string | null;
}

/**
 * Request metadata refreshed when a bearer token is authenticated.
 */
export interface AuthTokenUsage {
	/** Latest client IP address observed for the session. */
	ipAddress?: string | null;
}

/**
 * Safe session information suitable for account-management APIs.
 */
export interface AuthSessionData {
	id: string;
	name: string | null;
	ipAddress: string | null;
	browser: string | null;
	operatingSystem: string | null;
	device: string | null;
	expiresAt: string | null;
	lastUsedAt: string | null;
	createdAt: string | null;
}

/**
 * Persisted bearer token for API/mobile clients.
 *
 * The raw token is only returned to the client once. The database stores a
 * SHA-256 hash so a token table leak does not expose immediately usable bearer
 * tokens.
 */
export class AuthToken extends ActiveRecord {
	static override table = 'auth_tokens';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			userId: field.string({
				column: 'user_id',
				required: true,
				maxLength: 255,
				length: 255,
				indexes: [
					{
						name: 'auth_tokens_user_id_index',
						columns: ['user_id'],
					},
				],
			}),

			tokenHash: field.string({
				column: 'token_hash',
				required: true,
				unique: true,
				maxLength: 64,
				length: 64,
				hidden: true,
			}),

			name: field.string({
				maxLength: 120,
				length: 120,
			}),

			ipAddress: field.string({
				column: 'ip_address',
				maxLength: 45,
				length: 45,
				comment: 'Latest client IP address observed while this session was active.',
			}),

			userAgent: field.text({
				column: 'user_agent',
				hidden: true,
				comment: 'Raw client user-agent captured when this session was created.',
			}),

			browser: field.string({
				maxLength: 64,
				length: 64,
				comment: 'Parsed browser name used for account session displays.',
			}),

			operatingSystem: field.string({
				column: 'operating_system',
				maxLength: 64,
				length: 64,
				comment: 'Parsed operating-system name used for account session displays.',
			}),

			device: field.string({
				maxLength: 120,
				length: 120,
				comment: 'Parsed device model or category used for account session displays.',
			}),

			expiresAt: field.timestamp({
				column: 'expires_at',
			}),

			lastUsedAt: field.timestamp({
				column: 'last_used_at',
			}),

			revokedAt: field.timestamp({
				column: 'revoked_at',
				comment: 'When this bearer session was explicitly revoked.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare userId: string | null;
	declare tokenHash: string | null;
	declare name: string | null;
	declare ipAddress: string | null;
	declare userAgent: string | null;
	declare browser: string | null;
	declare operatingSystem: string | null;
	declare device: string | null;
	declare expiresAt: Date | null;
	declare lastUsedAt: Date | null;
	declare revokedAt: Date | null;
	declare createdAt: Date | null;

	/**
	 * Generates a cryptographically random bearer token.
	 *
	 * @returns Plaintext bearer token shown to the client once.
	 */
	static generatePlainTextToken(): string {
		return randomBytes(32).toString('base64url');
	}

	/**
	 * Hashes a plaintext bearer token for persistent lookup.
	 *
	 * @param token - Plaintext bearer token.
	 * @returns SHA-256 token hash.
	 */
	static hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}

	/**
	 * Returns whether the token has passed its expiry time.
	 *
	 * @param date - Comparison time.
	 * @returns True when the session is expired.
	 */
	isExpired(date = new Date()): boolean {
		return this.expiresAt !== null && this.expiresAt <= date;
	}

	/**
	 * Returns whether the session can currently authenticate.
	 *
	 * @param date - Comparison time.
	 * @returns True when the token is neither revoked nor expired.
	 */
	isActive(date = new Date()): boolean {
		return this.revokedAt === null && !this.isExpired(date);
	}

	/**
	 * Records token activity and optional request metadata.
	 *
	 * @param date - Activity time.
	 * @param usage - Request metadata observed during authentication.
	 */
	markUsed(date = new Date(), usage: AuthTokenUsage = {}): void {
		this.lastUsedAt = date;

		if (usage.ipAddress) {
			this.ipAddress = usage.ipAddress;
		}
	}

	/**
	 * Permanently revokes this session.
	 *
	 * @param date - Revocation time.
	 */
	revoke(date = new Date()): void {
		this.revokedAt = date;
	}

	/**
	 * Returns safe session information without the token hash or raw user agent.
	 *
	 * @returns Session data for account-management APIs.
	 */
	toSessionData(): AuthSessionData {
		return {
			id: String(this.id),
			name: this.name,
			ipAddress: this.ipAddress,
			browser: this.browser,
			operatingSystem: this.operatingSystem,
			device: this.device,
			expiresAt: this.expiresAt?.toISOString() ?? null,
			lastUsedAt: this.lastUsedAt?.toISOString() ?? null,
			createdAt: this.createdAt?.toISOString() ?? null,
		};
	}
}
