import { randomBytes, randomUUID } from 'node:crypto';
import { AuthProvider, PASSWORD_AUTH_PROVIDER } from '../AuthProvider';
import type * as auth from '../contracts';
import type { PasswordCredentials } from '../Auth';
import type { UserIdentity, UserIdentityModel } from '../UserIdentity';
import { defaultPasswordHash, type PasswordHash } from '../passwordHash';
import { PasswordSuspendedError } from '../PasswordSuspendedError';
import { PasswordLoginAttempt } from '../PasswordLoginAttempt';

const DEFAULT_MAX_FAILED_ATTEMPTS = 20;
/** Valid default-cost scrypt value used only for unknown-identity timing parity. */
const DUMMY_PASSWORD_HASH = 'scrypt$1$16384$8$1$64$0123456789abcdef0123456789abcdef$' + '00'.repeat(64);

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
	readonly #suspension: Required<auth.PasswordSuspensionOptions> | null;
	#dummyHash: Promise<string> | undefined;

	/**
	 * Creates a password auth provider.
	 *
	 * @param options - Password provider dependencies configured at app startup.
	 */
	constructor(options: auth.PasswordAuthProviderOptions<TIdentity>) {
		this.IdentityModel = options.identityModel;
		this.ProviderModel = options.providerModel ?? AuthProvider;
		this.passwordHash = options.passwordHash ?? defaultPasswordHash;
		this.#suspension = resolveSuspension(options.suspension);
	}

	/**
	 * Verifies credentials under the identity's durable attempt lock.
	 *
	 * Unknown identities receive the same failed-attempt accounting and password
	 * hashing work as existing accounts. Suspension persists until verified
	 * password recovery; a correct password cannot clear a suspended identity.
	 *
	 * @param input - Submitted password credentials.
	 * @returns Verified provider profile, or null for an invalid password.
	 * @throws {PasswordSuspendedError} When this identity needs password recovery.
	 */
	async verify(input: PasswordCredentials): Promise<auth.AuthProviderProfile | null> {
		if (!isPasswordCredentials(input)) return null;
		const identity = normalizeIdentity(input[this.IdentityModel.identityField]);
		if (!identity || identity.length > 255) return null;

		if (!this.#suspension) return this.#verifyPassword(identity, input.password);

		// Return the refusal from the transaction so the threshold update commits
		// before the public error is thrown.
		const result = await PasswordLoginAttempt.withIdentityLock(identity, async attempt => {
			if (attempt.suspendedAt) return new PasswordSuspendedError();
			const profile = await this.#verifyPassword(identity, input.password);
			if (profile) {
				attempt.failedAttempts = 0;
			} else {
				attempt.failedAttempts += 1;
				if (attempt.failedAttempts >= this.#suspension!.maxFailedAttempts) {
					attempt.suspendedAt = new Date();
					attempt.suspensionId = randomUUID();
				}
			}
			await attempt.save();
			return attempt.suspendedAt ? new PasswordSuspendedError({ attemptId: String(attempt.id), suspensionId: attempt.suspensionId! }) : profile;
		});

		if (result instanceof PasswordSuspendedError) throw result;
		return result;
	}

	/**
	 * Performs equivalent hashing work for known and unknown identities.
	 * @param identity - Normalized submitted identity.
	 * @param password - Submitted plaintext password, never persisted.
	 * @returns Profile only when an existing password credential matches.
	 */
	async #verifyPassword(identity: string, password: string): Promise<auth.AuthProviderProfile | null> {
		const provider = await this.findProvider(identity);
		// SQL collations may match distinct identities (for example accented text).
		// Only our exact normalized key may reach the credential verification path.
		if (!provider || normalizeIdentity(provider.providerUserId) !== identity) {
			const dummy = this.passwordHash === defaultPasswordHash
				? DUMMY_PASSWORD_HASH
				: await (this.#dummyHash ??= this.passwordHash.hash(randomBytes(32).toString('hex')).catch(error => {
					this.#dummyHash = undefined;
					throw error;
				}));
			await this.passwordHash.verify(password, dummy);
			return null;
		}
		return await provider.verifyPassword(password, this.passwordHash) ? profileFromProvider(provider) : null;
	}

	/**
	 * Replaces a verified owner's password and clears suspension atomically.
	 * Called by Auth only after a usable, identity-matched recovery token is locked.
	 * @param user - Account whose email recovery proof was verified.
	 * @param password - Replacement plaintext password.
	 * @returns Saved password provider.
	 */
	async recoverPassword(user: TIdentity, password: string): Promise<AuthProvider> {
		const identity = this.userIdentityValue(user);
		if (!identity) throw new Error('Cannot recover a password without an identity.');
		return PasswordLoginAttempt.withIdentityLock(identity, async attempt => {
			const provider = await this.setPassword(user, password);
			attempt.failedAttempts = 0;
			attempt.suspendedAt = null;
			attempt.suspensionId = null;
			await attempt.save();
			return provider;
		});
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

/**
 * Resolves the failed-attempt threshold and rejects invalid startup config.
 * @param options - Identity suspension policy, or false to disable accounting.
 * @returns Validated threshold, or null when disabled.
 */
function resolveSuspension(options: auth.PasswordSuspensionOptions | false | undefined): Required<auth.PasswordSuspensionOptions> | null {
	if (options === false) return null;
	const maxFailedAttempts = options?.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS;
	if (!Number.isSafeInteger(maxFailedAttempts) || maxFailedAttempts < 1 || maxFailedAttempts > 1_000_000) {
		throw new Error('Password suspension maxFailedAttempts must be an integer between 1 and 1000000.');
	}
	return { maxFailedAttempts };
}
