import {
	ActiveRecord,
	type ActiveRecordClass,
	type FieldBuilder,
} from '../db';

type RecoveryCodes = string[];

export type UserIdentityModel<TIdentity extends UserIdentity = UserIdentity> =
	ActiveRecordClass<TIdentity> & {
		identityField: string;
	};

/**
 * Auth-owned base user model.
 *
 * Apps can extend this model to add domain-specific fields and behaviour while
 * the auth package keeps ownership of account identity fields. Credential
 * storage lives on `AuthProvider` rows so users can link multiple login methods.
 */
export class UserIdentity extends ActiveRecord {
	static override table = 'users';
	static override primaryKey = 'id';
	static identityField = 'email';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			name: field.string({
				required: true,
				maxLength: 255,
				length: 255,
			}),

			email: field.email({
				required: true,
				maxLength: 255,
				length: 255,
				unique: true,
			}),

			emailVerifiedAt: field.timestamp({
				column: 'email_verified_at',
			}),

			avatarUrl: field.string({
				column: 'avatar_url',
				maxLength: 2048,
				length: 2048,
				comment: 'Account avatar URL. External providers may supply the initial value, while the account owns later changes.',
			}),

			rememberToken: field.string({
				column: 'remember_token',
				maxLength: 100,
				length: 100,
				hidden: true,
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),

			twoFactorSecret: field.text({
				column: 'two_factor_secret',
				hidden: true,
			}),

			twoFactorRecoveryCodes: field.jsonText<RecoveryCodes>({
				column: 'two_factor_recovery_codes',
				hidden: true,
			}),

			twoFactorConfirmedAt: field.timestamp({
				column: 'two_factor_confirmed_at',
			}),

			lastLoginAt: field.timestamp({
				column: 'last_login_at',
			}),

		};
	}

	declare id: string | null;
	declare name: string | null;
	declare email: string | null;
	declare emailVerifiedAt: Date | null;
	declare avatarUrl: string | null;
	declare rememberToken: string | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
	declare twoFactorSecret: string | null;
	declare twoFactorRecoveryCodes: RecoveryCodes | null;
	declare twoFactorConfirmedAt: Date | null;
	declare lastLoginAt: Date | null;

	get emailDomain(): string | null {
		return this.email ? this.email.split('@')[1] : null;
	}

	markEmailVerified(date = new Date()): void {
		this.emailVerifiedAt = date;
	}
}
