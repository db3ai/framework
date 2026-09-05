import { AuthProvider, PASSWORD_AUTH_PROVIDER } from '../AuthProvider';
import type * as auth from '../contracts';
import type { PasswordCredentials } from '../Auth';
import type { UserIdentity, UserIdentityModel } from '../UserIdentity';
import { defaultPasswordHash, type PasswordHash } from '../passwordHash';

/**
 * Construction options for the password auth provider.
 */
export interface PasswordAuthProviderOptions<TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * User identity model configured for the host app.
	 */
	identityModel: UserIdentityModel<TIdentity>;

	/**
	 * Provider-link model configured for the auth service.
	 */
	providerModel?: typeof AuthProvider;

	/**
	 * Password hashing service used to verify stored hashes.
	 */
	passwordHash?: PasswordHash;
}

/**
 * Provider driver for first-party email and password authentication.
 *
 * The password provider is not OAuth, but it still satisfies the same provider
 * contract by proving control of a provider-owned identity: the account email
 * plus a valid password hash stored on `auth_providers`.
 */
export class PasswordAuthProvider<TIdentity extends UserIdentity = UserIdentity> implements auth.AuthProviderDriver<PasswordCredentials, TIdentity> {
	readonly provider = PASSWORD_AUTH_PROVIDER;
	private readonly IdentityModel: UserIdentityModel<TIdentity>;
	private readonly ProviderModel: typeof AuthProvider;
	private readonly passwordHash: PasswordHash;

	/**
	 * Creates a password auth provider.
	 *
	 * @param options - Password provider dependencies configured at app startup.
	 */
	constructor(options: PasswordAuthProviderOptions<TIdentity>) {
		this.IdentityModel = options.identityModel;
		this.ProviderModel = options.providerModel ?? AuthProvider;
		this.passwordHash = options.passwordHash ?? defaultPasswordHash;
	}

	/**
	 * Verifies submitted password credentials against the stored provider row.
	 *
	 * @param input - Submitted password credential payload.
	 * @returns Normalized password provider profile, or null when verification fails.
	 */
	async verify(input: PasswordCredentials): Promise<auth.AuthProviderProfile | null> {
		if (!isPasswordCredentials(input)) return null;

		const identity = normalizeIdentity(input[this.IdentityModel.identityField]);

		if (!identity) return null;

		const provider = await this.findProvider(identity);

		if (!provider) return null;
		if (!await provider.verifyPassword(input.password, this.passwordHash)) return null;

		return profileFromProvider(provider);
	}

	/**
	 * Creates or replaces the password provider for a user.
	 *
	 * @param user - User who owns the password provider.
	 * @param password - Plaintext password to hash and store.
	 * @returns Saved password provider row.
	 */
	async setPassword(
		user: TIdentity,
		password: string,
	): Promise<AuthProvider> {
		const userId = this.userPrimaryKey(user);
		const email = this.userIdentityValue(user);

		if (!userId) {
			throw new Error('Cannot set a password provider for a user without an ID.');
		}

		if (!email) {
			throw new Error('Cannot set a password provider for a user without an identity email.');
		}

		const provider = await this.findUserProvider(userId)
			?? new this.ProviderModel({});

		provider.userId = userId;
		provider.provider = this.provider;
		provider.providerUserId = email;
		provider.email = email;
		provider.label = 'Password';
		provider.set('password', password);

		await provider.save();

		return provider;
	}

	/**
	 * Changes a user's password after verifying the current password.
	 *
	 * @param user - User whose password should change.
	 * @param currentPassword - Current plaintext password.
	 * @param nextPassword - Replacement plaintext password.
	 * @returns True when the password provider was changed.
	 */
	async changePassword(
		user: TIdentity,
		currentPassword: string,
		nextPassword: string,
	): Promise<boolean> {
		const userId = this.userPrimaryKey(user);

		if (!userId) return false;

		const provider = await this.findUserProvider(userId);

		if (!provider || !await provider.verifyPassword(currentPassword, this.passwordHash)) {
			return false;
		}

		provider.set('password', nextPassword);
		await provider.save();

		return true;
	}

	/**
	 * Links the password provider to an existing user.
	 *
	 * @param user - User receiving the password provider.
	 * @param input - Submitted password credential payload.
	 * @returns Saved provider row, or null when no password was supplied.
	 */
	async link(
		user: TIdentity,
		input: unknown,
	): Promise<AuthProvider | null> {
		const password = isPasswordCredentials(input) ? input.password : '';

		if (!password) return null;

		return this.setPassword(user, password);
	}

	/**
	 * Finds a password provider by normalized email identity.
	 *
	 * @param identity - Normalized email identity.
	 * @returns Matching password provider row, or null.
	 */
	private async findProvider(identity: string): Promise<AuthProvider | null> {
		return this.ProviderModel
			.query()
			.where('provider', this.provider)
			.where('providerUserId', identity)
			.first() as Promise<AuthProvider | null>;
	}

	/**
	 * Finds the password provider linked to a user.
	 *
	 * @param userId - User primary key.
	 * @returns Matching password provider row, or null.
	 */
	private async findUserProvider(userId: string): Promise<AuthProvider | null> {
		return this.ProviderModel
			.query()
			.where('userId', userId)
			.where('provider', this.provider)
			.first() as Promise<AuthProvider | null>;
	}

	/**
	 * Reads a user primary key as a non-empty string.
	 *
	 * @param user - User model to inspect.
	 * @returns Primary key string, or null when missing.
	 */
	private userPrimaryKey(user: TIdentity): string | null {
		const value = user.get(this.IdentityModel.primaryKey);

		return value === null || value === undefined || value === ''
			? null
			: String(value);
	}

	/**
	 * Reads the configured identity value from a user.
	 *
	 * @param user - User model to inspect.
	 * @returns Normalized identity value, or null when missing.
	 */
	private userIdentityValue(user: TIdentity): string | null {
		return normalizeIdentity(user.get(this.IdentityModel.identityField));
	}
}

/**
 * Checks whether a value can be used as password credentials.
 *
 * @param value - Unknown credential payload.
 * @returns True when a password string is present.
 */
export function isPasswordCredentials(value: unknown): value is PasswordCredentials {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as PasswordCredentials).password === 'string';
}

/**
 * Normalizes an auth identity value for provider matching.
 *
 * @param value - Unknown identity value.
 * @returns Lowercase trimmed identity string, or null.
 */
export function normalizeIdentity(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const normalized = value.trim().toLowerCase();

	return normalized || null;
}

/**
 * Builds a provider profile from a stored provider row.
 *
 * @param provider - Stored password provider row.
 * @returns Normalized provider profile.
 */
function profileFromProvider(provider: AuthProvider): auth.AuthProviderProfile {
	if (!provider.provider || !provider.providerUserId) {
		throw new Error('Cannot build an auth provider profile from an incomplete provider row.');
	}

	return {
		provider: provider.provider,
		providerUserId: provider.providerUserId,
		email: provider.email,
		emailVerifiedAt: provider.emailVerifiedAt,
		name: provider.name,
		avatarUrl: provider.avatarUrl,
		label: provider.label,
		profile: provider.profile,
	};
}
