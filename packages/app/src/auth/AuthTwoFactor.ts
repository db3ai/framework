import { ActiveRecord, type FieldBuilder } from '../db';

/**
 * One account's authenticator-app second factor. The secret is encrypted with the app's
 * security key; recovery codes are stored only as hashes and each works once.
 * A row with no `confirmedAt` is a setup the person has not finished, and does not apply.
 */
export class AuthTwoFactor extends ActiveRecord {
	static override table = 'auth_two_factor';
	static override primaryKey = 'id';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			userId: field.string({ column: 'user_id', required: true, unique: true, maxLength: 255, length: 255 }),
			secret: field.encryptedJson<{ key: string }>({ required: true, comment: 'Base32 TOTP key, encrypted.' }),
			recoveryCodes: field.json<string[]>({ column: 'recovery_codes', comment: 'SHA-256 hashes of unused recovery codes.' }),
			lastStep: field.integer({ column: 'last_step', unsigned: true, comment: 'Last accepted 30 s step, so a code works once.' }),
			confirmedAt: field.timestamp({ column: 'confirmed_at' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string | null;
	declare userId: string | null;
	declare secret: { key: string } | null;
	declare recoveryCodes: string[] | null;
	declare lastStep: number | null;
	declare confirmedAt: Date | null;
	declare createdAt: Date | null;
}
