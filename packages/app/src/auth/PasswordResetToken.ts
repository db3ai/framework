import {
	createHash,
	randomBytes,
} from 'node:crypto';

import {
	ActiveRecord,
	type FieldBuilder,
} from '../db';

/**
 * Single-use password reset token.
 *
 * The raw token is only sent in email. The database stores a SHA-256 hash so
 * reset-token table leaks do not expose usable reset links.
 */
export class PasswordResetToken extends ActiveRecord {
	static override table = 'password_reset_tokens';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			userId: field.string({
				column: 'user_id',
				required: true,
				maxLength: 255,
				length: 255,
			}),

			email: field.email({
				required: true,
				maxLength: 255,
				length: 255,
			}),

			tokenHash: field.string({
				column: 'token_hash',
				required: true,
				unique: true,
				maxLength: 64,
				length: 64,
			}),

			expiresAt: field.timestamp({
				column: 'expires_at',
				required: true,
			}),

			usedAt: field.timestamp({
				column: 'used_at',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare userId: string | null;
	declare email: string | null;
	declare tokenHash: string | null;
	declare expiresAt: Date | null;
	declare usedAt: Date | null;
	declare createdAt: Date | null;

	static generatePlainTextToken(): string {
		return randomBytes(32).toString('base64url');
	}

	static hashToken(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}

	isExpired(date = new Date()): boolean {
		return this.expiresAt !== null && this.expiresAt <= date;
	}

	isUsed(): boolean {
		return this.usedAt !== null;
	}

	isUsable(date = new Date()): boolean {
		return !this.isUsed() && !this.isExpired(date);
	}

	markUsed(date = new Date()): void {
		this.usedAt = date;
	}
}
