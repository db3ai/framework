import {
	ActiveRecord,
	PasswordField,
	type FieldBuilder,
} from '../db';
import type * as auth from './contracts';
import {
	defaultPasswordHash,
	type PasswordHash,
} from './passwordHash';

export const PASSWORD_AUTH_PROVIDER = 'password';

/** Safe provider metadata suitable for account-management screens. */
export interface AuthProviderSummary {
	/** Persistent provider-row identifier used for scoped removal. */
	id: string;
	/** Stable provider name such as password or google. */
	provider: string;
	/** Human-friendly provider label. */
	label: string | null;
	/** Email address reported or owned by the provider. */
	email: string | null;
	/** Avatar URL reported by the provider. */
	avatarUrl: string | null;
	/** Most recent successful login through this provider. */
	lastLoginAt: string | null;
	/** Time the provider was linked to the account. */
	createdAt: string | null;
}

/**
 * Persisted authentication method linked to one user account.
 *
 * Password, Google, magic-link, and future login mechanisms all share this
 * model. Provider-specific verification happens in the auth service or a
 * provider driver; this model owns the durable account-to-provider link.
 */
export class AuthProvider extends ActiveRecord {
	static override table = 'auth_providers';
	static override primaryKey = 'id';
	static override comment = 'Authentication provider linked to a user account. Password credentials and external login identities share this table.';

	/**
	 * Defines the provider link, credential, and display metadata columns.
	 *
	 * @param field - Framework field builder.
	 * @returns Field definitions for the auth provider table.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),

			userId: field.string({
				column: 'user_id',
				required: true,
				maxLength: 255,
				length: 255,
				comment: 'User account this authentication provider belongs to.',
				indexes: [
					{
						name: 'auth_providers_user_id_index',
						columns: ['user_id'],
					},
					{
						name: 'auth_providers_user_provider_unique',
						columns: ['user_id', 'provider'],
						unique: true,
					},
					{
						name: 'auth_providers_provider_user_id_unique',
						columns: ['provider', 'provider_user_id'],
						unique: true,
					},
				],
			}),

			provider: field.string({
				required: true,
				maxLength: 64,
				length: 64,
				comment: 'Stable provider name such as password, google, or magic_link.',
			}),

			providerUserId: field.string({
				column: 'provider_user_id',
				required: true,
				maxLength: 255,
				length: 255,
				comment: 'Stable provider-owned user id. For password this is the normalized email address.',
			}),

			label: field.string({
				maxLength: 255,
				length: 255,
				comment: 'Human-friendly label for settings screens.',
			}),

			email: field.email({
				maxLength: 255,
				length: 255,
				comment: 'Email address reported or proven by this provider.',
			}),

			emailVerifiedAt: field.timestamp({
				column: 'email_verified_at',
				comment: 'When this provider proved the linked email address.',
			}),

			name: field.string({
				maxLength: 255,
				length: 255,
				comment: 'Display name reported by the provider.',
			}),

			avatarUrl: field.string({
				column: 'avatar_url',
				maxLength: 2048,
				length: 2048,
				comment: 'Avatar URL reported by the provider.',
			}),

			password: field.password({
				required: false,
				minLength: 12,
				comment: 'Password hash for the built-in password provider. Null for external providers.',
			}),

			profile: field.jsonText<Record<string, unknown>>({
				column: 'profile_json',
				comment: 'Safe provider metadata captured during verification.',
			}),

			lastLoginAt: field.timestamp({
				column: 'last_login_at',
				comment: 'Last time this provider was used to authenticate.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	/**
	 * Applies normalized provider metadata to this row.
	 *
	 * @param profile - Provider profile returned by a driver.
	 */
	public applyProfile(profile: auth.AuthProviderProfile): void {
		this.provider = profile.provider;
		this.providerUserId = profile.providerUserId;
		this.email = profile.email ?? null;
		this.emailVerifiedAt = profile.emailVerifiedAt ?? null;
		this.name = profile.name ?? null;
		this.avatarUrl = profile.avatarUrl ?? null;
		this.label = profile.label ?? providerLabel(profile);
		this.profile = profile.profile ?? null;
	}

	/**
	 * Marks this provider as used for authentication.
	 *
	 * @param date - Login time to store.
	 */
	public markUsed(date = new Date()): void {
		this.lastLoginAt = date;
	}

	/**
	 * Returns true when this provider stores a local password credential.
	 *
	 * @returns Whether this row is the built-in password provider.
	 */
	public isPasswordProvider(): boolean {
		return this.provider === PASSWORD_AUTH_PROVIDER;
	}

	/**
	 * Returns settings-safe provider metadata.
	 *
	 * Password hashes, provider-owned identifiers, and raw profile metadata are
	 * deliberately excluded from this projection.
	 *
	 * @returns Provider summary for account-management APIs.
	 */
	public toSummary(): AuthProviderSummary {
		return {
			id: String(this.id),
			provider: this.provider ?? '',
			label: this.label,
			email: this.email,
			avatarUrl: this.avatarUrl,
			lastLoginAt: this.lastLoginAt?.toISOString() ?? null,
			createdAt: this.createdAt?.toISOString() ?? null,
		};
	}

	/**
	 * Verifies a plaintext password against the provider password hash.
	 *
	 * @param plainText - Password supplied by the user.
	 * @param passwordHash - Password hashing service to use.
	 * @returns True when the password matches this provider.
	 */
	public verifyPassword(
		plainText: string,
		passwordHash: PasswordHash = defaultPasswordHash,
	): Promise<boolean> {
		const passwordField = this.getBoundField('password');

		if (!(passwordField instanceof PasswordField)) {
			throw new Error('AuthProvider password field is not a password field.');
		}

		return passwordField.verifyPassword(plainText, passwordHash);
	}

	declare id: string | null;
	declare userId: string | null;
	declare provider: string | null;
	declare providerUserId: string | null;
	declare label: string | null;
	declare email: string | null;
	declare emailVerifiedAt: Date | null;
	declare name: string | null;
	declare avatarUrl: string | null;
	declare password: null;
	declare profile: Record<string, unknown> | null;
	declare lastLoginAt: Date | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}

/**
 * Builds a compact default settings label for a provider profile.
 *
 * @param profile - Normalized provider profile.
 * @returns Provider settings label.
 */
function providerLabel(profile: auth.AuthProviderProfile): string {
	if (profile.provider === PASSWORD_AUTH_PROVIDER) return 'Password';
	if (profile.email) return `${profile.provider}: ${profile.email}`;
	return profile.provider;
}
