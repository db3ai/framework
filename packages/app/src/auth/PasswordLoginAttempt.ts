import { createHash } from 'node:crypto';
import { ActiveRecord, type FieldBuilder } from '../db';

/**
 * Durable failed-password state for any submitted identity, known or unknown.
 *
 * The unique normalized identity digest provides a database-wide serialization
 * point without requiring an account. The normalized submitted email is also
 * retained so operators can investigate attempts against known or unknown users.
 * This table is intentionally independent of users and authentication providers.
 */
export class PasswordLoginAttempt extends ActiveRecord {
	static override table = 'auth_password_login_attempts';

	/** Defines the identity key, failure counter and persistent suspension. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			identityHash: field.string({ column: 'identity_hash', required: true, unique: true, length: 64, maxLength: 64, comment: 'SHA-256 of the normalized submitted identity; not tied to account existence.' }),
			identity: field.string({ length: 255, maxLength: 255, comment: 'Normalized submitted email or configured identity; null for legacy digest-only rows until their next attempt.' }),
			failedAttempts: field.integer({ column: 'failed_attempts', required: true, unsigned: true, min: 0, default: 0, comment: 'Consecutive wrong passwords for this identity.' }),
			suspendedAt: field.timestamp({ column: 'suspended_at', comment: 'When password recovery became required; no automatic expiry.' }),
			suspensionId: field.string({ column: 'suspension_id', length: 36, maxLength: 36, comment: 'Unique suspension occurrence; prevents delayed recovery notices from referring to a later suspension.' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
			updatedAt: field.timestamp({ column: 'updated_at', auto: 'both', index: true, comment: 'Latest password sign-in or recovery activity, including refused suspended attempts.' }),
		};
	}

	declare id: string | null;
	declare identityHash: string;
	/** Readable submitted identity, populated on the next attempt for legacy rows. */
	declare identity: string | null;
	declare failedAttempts: number;
	declare suspendedAt: Date | null;
	/** Unique occurrence identifier, cleared only by verified password recovery. */
	declare suspensionId: string | null;

	/**
	 * Derives an exact stable key unaffected by the database's email collation.
	 * @param identity - Submitted email or configured password identity.
	 * @returns SHA-256 of the trimmed, lowercase identity.
	 */
	static identityKey(identity: string): string {
		return createHash('sha256').update(identity.trim().toLowerCase()).digest('hex');
	}

	/**
	 * Serializes one verification or recovery with every operation for this identity.
	 *
	 * The unique-key upsert handles concurrent first attempts. Locking reads see
	 * the latest committed state, including under repeatable-read isolation.
	 * Nested use during recovery participates through a transaction savepoint.
	 *
	 * Records the normalized identity and latest activity even when already suspended.
	 * @param identity - Password identity, whether or not registered.
	 * @param callback - Operation that may update and save the locked attempt row.
	 * @returns Callback result after its state commits.
	 */
	static async withIdentityLock<TResult>(identity: string, callback: (attempt: PasswordLoginAttempt) => Promise<TResult>): Promise<TResult> {
		return this.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const identityHash = this.identityKey(identity);
			const candidate = this.create({ identityHash, identity: identity.trim().toLowerCase() });
			// Framework-level upsert requires Knex; the fields still own every value
			// and column conversion. Updating activity takes an exclusive key lock;
			// INSERT IGNORE would take shared locks and can deadlock on FOR UPDATE.
			await transaction(this.table).insert(await candidate.getDataForDb()).onConflict(this.getFields().identityHash!.column).merge([this.getFields().identity!.column, this.getFields().updatedAt!.column]);
			const attempt = await this.where('identityHash', identityHash).forUpdate().first() as PasswordLoginAttempt | null;
			if (!attempt) throw new Error('Unable to lock password login state.');
			return callback(attempt);
		}));
	}
}
