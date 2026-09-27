import { ActiveRecord, type Database } from '../db';
import type { Knex } from 'knex';
import { isPromiseLike } from '@db3.ai/pure';
import type { Config } from '../config';
import { AuthProvider, PASSWORD_AUTH_PROVIDER } from './AuthProvider';
import { AuthToken, type AuthTokenUsage, type CreateAuthTokenOptions } from './AuthToken';
import { PasswordResetToken } from './PasswordResetToken';
import { defaultPasswordHash, type PasswordHash } from './passwordHash';
import { UserIdentity, type UserIdentityModel } from './UserIdentity';
import type * as auth from './contracts';
import { PasswordAuthProvider, resolveAuthProviders } from './providers';

/**
 * Credentials accepted by the built-in password provider.
 *
 * Apps may include the configured identity field, usually `email`, alongside
 * the password so the auth service can locate the provider row.
 */
export interface PasswordCredentials {
	/**
	 * Plaintext password submitted by the user.
	 */
	password: string;

	/**
	 * Additional credential fields, including the configured identity value.
	 */
	[fieldName: string]: unknown;
}

/**
 * Input used when creating a user through the built-in password provider.
 */
export interface RegisterPasswordInput extends PasswordCredentials {
	/**
	 * Additional user fields accepted by the configured identity model.
	 */
	[fieldName: string]: unknown;
}

/**
 * Backwards-compatible alias for password credentials.
 */
export type AuthCredentials = PasswordCredentials;

/**
 * Backwards-compatible alias for password registration input.
 */
export type RegisterIdentityInput = RegisterPasswordInput;

/**
 * Request payload used to redeem a password reset token.
 *
 * Additional fields allow apps to include the configured identity value, such
 * as an email address, so token redemption can confirm the link belongs to the
 * submitted identity.
 */
export interface ResetPasswordInput {
	[fieldName: string]: unknown;
	token: string;
	password: string;
}

/**
 * Bearer token issued for an authenticated user.
 */
export interface IssuedAuthToken<TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * Token type used in HTTP Authorization headers.
	 */
	type: 'Bearer';

	/**
	 * Plaintext bearer token shown once to the caller.
	 */
	token: string;

	/**
	 * Absolute expiry time, or null for a non-expiring token.
	 */
	expiresAt: Date | null;

	/**
	 * Authenticated identity the token belongs to.
	 */
	user: TIdentity;
}

/**
 * Password reset token issued for an identity.
 */
export interface IssuedPasswordResetToken<TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * Token purpose marker.
	 */
	type: 'password_reset';

	/**
	 * Plaintext reset token shown once to the caller.
	 */
	token: string;

	/**
	 * Absolute expiry time for the reset token.
	 */
	expiresAt: Date;

	/**
	 * Identity the reset token belongs to.
	 */
	user: TIdentity;
}

/**
 * Options used when issuing a bearer token.
 */
export interface AuthTokenOptions extends CreateAuthTokenOptions {
	/**
	 * Relative token lifetime in milliseconds. Null disables token expiry.
	 */
	expiresInMs?: number | null;
}

export interface PasswordResetTokenOptions {
	/**
	 * Absolute timestamp when the token should stop being usable.
	 */
	expiresAt?: Date;

	/**
	 * Relative token lifetime in milliseconds when an absolute expiry is not supplied.
	 */
	expiresInMs?: number;
}

/**
 * Initial values accepted by an auth request context.
 */
export type AuthRequestContextValues =
	| Map<string, unknown>
	| Record<string, unknown>
	| Iterable<readonly [string, unknown]>;

/**
 * Request-scoped storage used to isolate auth state between concurrent requests.
 */
export interface AuthRequestContext {
	/**
	 * True when code is running inside an active request context.
	 */
	active: boolean;

	/**
	 * Runs a callback with optional initial request-scoped values.
	 *
	 * @param callback - Work to run inside the request context.
	 * @param initialValues - Optional values to seed into the context.
	 * @returns The callback result.
	 */
	run<TResult>(
		callback: () => TResult,
		initialValues?: AuthRequestContextValues,
	): TResult;

	/**
	 * Reads a request-scoped value.
	 *
	 * @param key - Context key to read.
	 * @returns Stored value, or undefined when missing.
	 */
	get<TValue = unknown>(key: string): TValue | undefined;

	/**
	 * Stores a request-scoped value.
	 *
	 * @param key - Context key to write.
	 * @param value - Value to store.
	 * @returns The stored value.
	 */
	set<TValue>(key: string, value: TValue): TValue;

	/**
	 * Reads a value or stores the factory result when missing.
	 *
	 * @param key - Context key to read or populate.
	 * @param factory - Factory used when no value has been stored.
	 * @returns Existing or newly-created value.
	 */
	remember<TValue>(key: string, factory: () => TValue): TValue;
}

/**
 * Runtime options for the framework auth service.
 */
export interface AuthOptions<TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * Database wrapper used for auth persistence.
	 */
	db: Database;

	/**
	 * User identity model for the host app.
	 */
	identityModel?: UserIdentityModel<TIdentity>;

	/**
	 * Provider-link model. Override only when extending provider persistence.
	 */
	providerModel?: typeof AuthProvider;

	/**
	 * Authentication providers enabled for the app.
	 */
	providers?: auth.AuthProviderRegistry<TIdentity>;

	/**
	 * App config repository used to read `auth.providers` when explicit
	 * providers are not supplied.
	 */
	config?: Config;

	/**
	 * Password hashing service for password provider credentials.
	 */
	passwordHash?: PasswordHash;

	/**
	 * Bearer token model.
	 */
	tokenModel?: typeof AuthToken;

	/**
	 * Default bearer token lifetime in milliseconds. Null disables expiry.
	 */
	tokenLifetimeMs?: number | null;

	/**
	 * Password reset token model.
	 */
	passwordResetTokenModel?: typeof PasswordResetToken;

	/**
	 * Default password reset token lifetime in milliseconds.
	 */
	passwordResetTokenLifetimeMs?: number;

	/**
	 * Request context used to isolate current-user state.
	 */
	requestContext?: AuthRequestContext;
}

/**
 * Error thrown when registration would duplicate an existing identity.
 */
export class AuthIdentityExistsError extends Error {
	/**
	 * Creates an identity duplication error.
	 *
	 * @param field - Logical identity field that collided.
	 * @param value - Submitted identity value.
	 */
	constructor(
		public readonly field: string,
		public readonly value: unknown,
	) {
		super(`An identity already exists for ${field}.`);
		this.name = 'AuthIdentityExistsError';
	}
}

/**
 * Error thrown when code attempts to use a disabled auth provider.
 */
export class AuthProviderNotConfiguredError extends Error {
	/**
	 * Creates a provider configuration error.
	 *
	 * @param provider - Provider name that is not enabled.
	 */
	constructor(public readonly provider: string) {
		super(`Auth provider "${provider}" is not configured.`);
		this.name = 'AuthProviderNotConfiguredError';
	}
}

/**
 * Error thrown when unlinking a provider would leave a user unable to log in.
 */
export class AuthLastProviderError extends Error {
	/**
	 * Creates a last-provider removal error.
	 */
	constructor() {
		super('Cannot remove the last authentication provider from a user.');
		this.name = 'AuthLastProviderError';
	}
}

export const AUTH_USER_CONTEXT_KEY = 'auth.user';
const AUTH_TOKEN_CONTEXT_KEY_PREFIX = 'auth.token';
const AUTH_TOKEN_RECORD_CONTEXT_KEY = 'auth.token.record';

/**
 * Authentication service for the current app/request scope.
 */
export class Auth<TIdentity extends UserIdentity = UserIdentity> {
	private fallbackAuthenticatedUser: TIdentity | null = null;
	private fallbackAuthenticatedToken: AuthToken | null = null;
	private readonly db: Database;
	private readonly IdentityModel: UserIdentityModel<TIdentity>;
	private readonly ProviderModel: typeof AuthProvider;
	private readonly TokenModel: typeof AuthToken;
	private readonly PasswordResetTokenModel: typeof PasswordResetToken;
	private readonly providerRegistry: Record<string, auth.AuthProviderDriver<unknown, TIdentity>>;
	private readonly passwordHash: PasswordHash;
	private readonly tokenLifetimeMs: number | null;
	private readonly passwordResetTokenLifetimeMs: number;
	private readonly requestContext?: AuthRequestContext;

	/**
	 * Creates an auth service bound to a database and provider registry.
	 *
	 * @param options - Auth runtime options.
	 */
	constructor(options: AuthOptions<TIdentity>) {
		this.db = options.db;
		this.IdentityModel = options.identityModel
			?? (UserIdentity as unknown as UserIdentityModel<TIdentity>);
		this.ProviderModel = options.providerModel ?? AuthProvider;
		this.TokenModel = options.tokenModel ?? AuthToken;
		this.PasswordResetTokenModel = options.passwordResetTokenModel ?? PasswordResetToken;
		this.passwordHash = options.passwordHash ?? defaultPasswordHash;
		this.providerRegistry = resolveAuthProviders<TIdentity>(
			options.providers ?? options.config?.get<auth.AuthProviderRegistry<TIdentity>>('auth.providers') ?? {
				[PASSWORD_AUTH_PROVIDER]: true,
			},
			{
				identityModel: this.IdentityModel,
				providerModel: this.ProviderModel,
				passwordHash: this.passwordHash,
			},
		);
		this.tokenLifetimeMs = options.tokenLifetimeMs ?? 30 * 24 * 60 * 60 * 1000;
		this.passwordResetTokenLifetimeMs = options.passwordResetTokenLifetimeMs ?? 60 * 60 * 1000;
		this.requestContext = options.requestContext;
	}

	/**
	 * Hashes a plaintext password using the configured auth password service.
	 *
	 * @param plainText - Plaintext password to hash.
	 * @returns Stored password hash.
	 */
	hashPassword(plainText: string): Promise<string> {
		return this.passwordHash.hash(plainText);
	}

	/**
	 * Verifies a plaintext password against a stored password hash.
	 *
	 * @param plainText - Plaintext password supplied by the user.
	 * @param hash - Stored password hash.
	 * @returns True when the password matches.
	 */
	verifyPassword(plainText: string, hash: string): Promise<boolean> {
		return this.passwordHash.verify(plainText, hash);
	}

	/**
	 * Returns configured authentication provider names.
	 *
	 * @returns Enabled provider names.
	 */
	configuredProviders(): string[] {
		return Object.keys(this.providerRegistry);
	}

	/**
	 * True when a user is currently authenticated.
	 */
	get check(): boolean {
		return this.user !== null;
	}

	/**
	 * The currently authenticated user, or null when no user is authenticated.
	 */
	get user(): TIdentity | null {
		if (this.requestContext?.active) {
			return this.requestContext.get<TIdentity | null>(AUTH_USER_CONTEXT_KEY) ?? null;
		}

		return this.fallbackAuthenticatedUser;
	}

	/**
	 * Returns the bearer-token record authenticated for the current request.
	 */
	get token(): AuthToken | null {
		if (this.requestContext?.active) {
			return this.requestContext.get<AuthToken | null>(AUTH_TOKEN_RECORD_CONTEXT_KEY) ?? null;
		}

		return this.fallbackAuthenticatedToken;
	}

	/**
	 * Runs work inside an isolated auth scope.
	 *
	 * HTTP routes should use this so `auth.user` cannot bleed between concurrent
	 * requests on the shared app singleton.
	 *
	 * @param user - User to expose as authenticated inside the callback.
	 * @param callback - Work to run inside the auth scope.
	 * @returns The callback result.
	 */
	runWithUser<TResult>(
		user: TIdentity | null,
		callback: () => TResult,
	): TResult {
		if (this.requestContext) {
			return this.requestContext.run(callback, {
				[AUTH_USER_CONTEXT_KEY]: user,
			});
		}

		return this.runWithFallbackUser(user, callback);
	}

	/**
	 * Attempts to authenticate password credentials and stores the user on success.
	 *
	 * @param credentials - Password provider credentials.
	 * @returns True when credentials authenticated successfully.
	 */
	async attempt(credentials: PasswordCredentials): Promise<boolean> {
		return await this.authenticatePassword(credentials) !== null;
	}

	/**
	 * Authenticates password credentials and returns the user on success.
	 *
	 * @param credentials - Password provider credentials.
	 * @returns Authenticated user, or null when credentials fail.
	 */
	async authenticate(credentials: PasswordCredentials): Promise<TIdentity | null> {
		return this.authenticatePassword(credentials);
	}

	/**
	 * Authenticates password credentials and returns the user on success.
	 *
	 * @param credentials - Password provider credentials.
	 * @returns Authenticated user, or null when credentials fail.
	 */
	async authenticatePassword(credentials: PasswordCredentials): Promise<TIdentity | null> {
		return this.authenticateProvider(PASSWORD_AUTH_PROVIDER, credentials);
	}

	/**
	 * Authenticates credentials and creates a bearer token on success.
	 *
	 * @param credentials - Password provider credentials.
	 * @param options - Token creation options.
	 * @returns Issued token, or null when credentials fail.
	 */
	async issueToken(
		credentials: PasswordCredentials,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity> | null> {
		return this.issueTokenForPassword(credentials, options);
	}

	/**
	 * Authenticates password credentials and creates a bearer token on success.
	 *
	 * @param credentials - Password provider credentials.
	 * @param options - Token creation options.
	 * @returns Issued token, or null when credentials fail.
	 */
	async issueTokenForPassword(
		credentials: PasswordCredentials,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity> | null> {
		const user = await this.authenticatePassword(credentials);

		if (!user) {
			return null;
		}

		return this.createToken(user, options);
	}

	/**
	 * Authenticates through a configured provider and creates a bearer token.
	 *
	 * @param provider - Configured provider name.
	 * @param input - Provider-specific credential payload.
	 * @param options - Token creation options.
	 * @returns Issued token, or null when provider verification fails.
	 */
	async issueTokenForProvider(
		provider: string,
		input: unknown,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity> | null> {
		const user = await this.authenticateProvider(provider, input);

		if (!user) {
			return null;
		}

		return this.createToken(user, options);
	}

	/**
	 * Creates a new password-backed identity and returns its first bearer token.
	 *
	 * @param input - User fields and password provider credential.
	 * @param options - Token creation options.
	 * @returns Issued token for the new user.
	 */
	async register(
		input: RegisterPasswordInput,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity>> {
		return this.registerWithPassword(input, options);
	}

	/**
	 * Creates a new user and links the built-in password provider.
	 *
	 * @param input - User fields and password provider credential.
	 * @param options - Token creation options.
	 * @returns Issued token for the new user.
	 */
	async registerWithPassword(
		input: RegisterPasswordInput,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity>> {
		this.requireProvider(PASSWORD_AUTH_PROVIDER);

		const identity = this.normalizedIdentity(input);

		if (identity) {
			const existing = await this.findIdentity(input);

			if (existing) {
				throw new AuthIdentityExistsError(this.IdentityModel.identityField, identity);
			}
		}

		const {
			password: _password,
			...userInput
		} = input;

		const user = new this.IdentityModel(userInput, {
			db: this.db.knex,
		});

		await user.save();
		await this.setPasswordProvider(user, input.password);
		await this.login(user);

		return this.createToken(user, options);
	}

	/**
	 * Returns the authentication providers linked to a user.
	 *
	 * @param user - User whose providers should be loaded.
	 * @returns Provider rows linked to the user.
	 */
	async providersFor(user: TIdentity): Promise<AuthProvider[]> {
		const userId = this.userPrimaryKey(user);

		if (!userId) return [];

		return this.ProviderModel
			.query(this.db.knex)
			.where('userId', userId)
			.orderBy('createdAt', 'asc')
			.all() as Promise<AuthProvider[]>;
	}

	/**
	 * Links a configured provider to an existing user.
	 *
	 * @param user - User receiving the new provider link.
	 * @param provider - Configured provider name.
	 * @param input - Provider-specific credential payload.
	 * @returns Linked provider row, or null when verification fails.
	 */
	async linkProvider(
		user: TIdentity,
		provider: string,
		input: unknown,
	): Promise<AuthProvider | null> {
		const driver = this.requireProvider(provider);

		if (hasProviderLink(driver)) {
			return ActiveRecord.withDb(this.db.knex, () => driver.link(user, input));
		}

		const profile = await this.verifyProvider(provider, input, user);

		if (!profile) return null;

		return this.saveLinkedProvider(user, profile);
	}

	/**
	 * Removes one provider from a user while preserving at least one login path.
	 *
	 * @param user - User whose provider should be removed.
	 * @param providerIdOrName - Provider row id or provider name to remove.
	 * @returns True when a provider row was deleted.
	 */
	async unlinkProvider(user: TIdentity, providerIdOrName: string): Promise<boolean> {
		const providers = await this.providersFor(user);

		if (providers.length <= 1) {
			throw new AuthLastProviderError();
		}

		const provider = providers.find(candidate => {
			return candidate.id === providerIdOrName || candidate.provider === providerIdOrName;
		});

		if (!provider) return false;

		await provider.delete(this.db.knex);
		return true;
	}

	/**
	 * Creates or replaces the built-in password provider for a user.
	 *
	 * @param user - User who owns the password provider.
	 * @param password - New plaintext password to hash and store.
	 * @returns Saved password provider row.
	 */
	async setPasswordProvider(user: TIdentity, password: string): Promise<AuthProvider> {
		return ActiveRecord.withDb(this.db.knex, () => {
			return this.passwordProvider().setPassword(user, password);
		});
	}

	/**
	 * Changes a user's password provider after verifying the current password.
	 * Password replacement, recovery-link invalidation and revocation of every
	 * bearer session (including the current session) commit together.
	 *
	 * @param user - User whose password should change.
	 * @param currentPassword - Current plaintext password for verification.
	 * @param nextPassword - Replacement plaintext password.
	 * @returns True when the password was changed.
	 */
	async changePasswordProvider(
		user: TIdentity,
		currentPassword: string,
		nextPassword: string,
	): Promise<boolean> {
		const userId = this.userPrimaryKey(user);
		if (!userId) return false;

		const changed = await this.db.knex.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const lockedUser = await this.#lockIdentity(userId, transaction);
			if (!lockedUser) return false;
			if (!await this.passwordProvider().changePassword(lockedUser, currentPassword, nextPassword)) return false;
			await this.#invalidatePasswordRecovery(userId, transaction);
			return true;
		}));

		if (changed) this.#forgetRevokedUser(userId);
		return changed;
	}

	/**
	 * Authenticates through a non-password provider and stores the user on success.
	 *
	 * @param provider - Configured provider name.
	 * @param input - Provider-specific credential payload.
	 * @returns Authenticated user, or null when verification fails.
	 */
	async authenticateProvider(
		provider: string,
		input: unknown,
	): Promise<TIdentity | null> {
		const profile = await this.verifyProvider(provider, input, null);

		if (!profile) {
			this.logout();
			return null;
		}

		const providerRecord = await this.findProvider(profile.provider, profile.providerUserId);
		const user = providerRecord
			? await this.userForProvider(providerRecord)
			: await this.createIdentityForProvider(profile);

		if (!user) {
			this.logout();
			return null;
		}

		this.applyProviderProfileDefaults(user, profile);

		const linkedProvider = providerRecord ?? new this.ProviderModel({}, {
			db: this.db.knex,
		});

		linkedProvider.userId = this.userPrimaryKey(user);
		linkedProvider.applyProfile(profile);
		linkedProvider.markUsed();
		await linkedProvider.save();
		await this.login(user);

		return user;
	}

	/**
	 * Creates a single-use password reset token for an already-loaded identity.
	 *
	 * Callers should find the identity at the request boundary and pass the
	 * loaded model here so token creation only owns token persistence.
	 *
	 * @param user - Identity receiving the reset token.
	 * @param options - Reset token creation options.
	 * @returns Issued password reset token.
	 */
	async createPasswordResetToken(
		user: TIdentity,
		options: PasswordResetTokenOptions = {},
	): Promise<IssuedPasswordResetToken<TIdentity>> {
		this.requireProvider(PASSWORD_AUTH_PROVIDER);

		const userId = this.userPrimaryKey(user);
		const email = this.userIdentityValue(user);

		if (!userId) {
			throw new Error('Cannot create a password reset token for a user without an ID.');
		}

		if (!email) {
			throw new Error('Cannot create a password reset token for a user without an email.');
		}

		const token = this.PasswordResetTokenModel.generatePlainTextToken();
		const expiresAt = options.expiresAt ?? this.defaultPasswordResetTokenExpiry(options.expiresInMs);
		const tokenRecord = new this.PasswordResetTokenModel({
			userId,
			email,
			tokenHash: this.PasswordResetTokenModel.hashToken(token),
			expiresAt,
		}, {
			db: this.db.knex,
		});

		await tokenRecord.save();

		return {
			type: 'password_reset',
			token,
			expiresAt,
			user,
		};
	}

	/**
	 * Resets the password provider using a valid password reset token.
	 * Serializes recovery for an account and atomically invalidates every existing
	 * session and recovery link. Failed validation leaves credentials unchanged.
	 *
	 * @param input - Reset token, new password, and optional identity value.
	 * @returns Identity whose password changed, or null when redemption fails.
	 */
	async resetPassword(input: ResetPasswordInput): Promise<TIdentity | null> {
		this.requireProvider(PASSWORD_AUTH_PROVIDER);

		if (!input.token || !input.password) {
			return null;
		}

		const tokenRecord = await this.PasswordResetTokenModel
			.query(this.db.knex)
			.where('tokenHash', this.PasswordResetTokenModel.hashToken(input.token))
			.first() as PasswordResetToken | null;

		if (!tokenRecord || !tokenRecord.isUsable()) {
			return null;
		}

		if (!tokenRecord.userId) return null;
		const user = await this.db.knex.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const lockedUser = await this.#lockIdentity(tokenRecord.userId!, transaction);
			if (!lockedUser) return null;

			// A locking read sees a competing redemption's committed state after
			// waiting for the account lock, including under repeatable-read SQL.
			const row = await this.PasswordResetTokenModel.query(transaction)
				.where('id', tokenRecord.id).toKnex().forUpdate().first();
			const current = row ? this.PasswordResetTokenModel.fromDb(row, transaction) : null;
			if (!current?.isUsable() || !await this.passwordResetIdentityMatches(input, lockedUser)) return null;

			await this.passwordProvider().recoverPassword(lockedUser, input.password);
			await this.#invalidatePasswordRecovery(tokenRecord.userId!, transaction);
			return lockedUser;
		}));

		if (user) {
			user.setDb(this.db.knex);
			this.#forgetRevokedUser(this.userPrimaryKey(user)!);
		}
		return user;
	}

	/** Locks the account row to serialize concurrent password replacements. */
	async #lockIdentity(userId: string, transaction: Knex.Transaction): Promise<TIdentity | null> {
		const row = await this.IdentityModel.query(transaction)
			.where(this.IdentityModel.primaryKey, userId).toKnex().forUpdate().first();
		return row ? this.IdentityModel.fromDb(row, transaction) as TIdentity : null;
	}

	/** Invalidates recovery links and sessions within the password transaction. */
	async #invalidatePasswordRecovery(userId: string, transaction: Knex.Transaction): Promise<void> {
		await this.PasswordResetTokenModel.query(transaction)
			.where('userId', userId).whereNull('usedAt').patch({ usedAt: new Date() });
		await this.#revokeTokens(userId, transaction);
	}

	/** Applies session revocation on the owning connection or password transaction. */
	async #revokeTokens(userId: string, connection: Knex): Promise<number> {
		return this.TokenModel.query(connection)
			.where('userId', userId).whereNull('revokedAt').patch({ revokedAt: new Date() });
	}

	/** Discards cached bearer authentication after committed account revocation. */
	#forgetRevokedUser(userId: string): void {
		if (this.requestContext?.active) {
			const key = `${AUTH_TOKEN_CONTEXT_KEY_PREFIX}.${this.TokenModel.table}.revision`;
			this.requestContext.set(key, (this.requestContext.get<number>(key) ?? 0) + 1);
		}
		if (this.user && this.userPrimaryKey(this.user) === userId) this.logout();
	}

	/**
	 * Creates a bearer token for an already-authenticated identity.
	 *
	 * @param user - Identity receiving the bearer token.
	 * @param options - Token creation options.
	 * @returns Issued bearer token.
	 */
	async createToken(
		user: TIdentity,
		options: AuthTokenOptions = {},
	): Promise<IssuedAuthToken<TIdentity>> {
		const userId = this.userPrimaryKey(user);

		if (!userId) {
			throw new Error('Cannot create an auth token for a user without an ID.');
		}

		const token = this.TokenModel.generatePlainTextToken();
		const expiresAt = options.expiresAt === undefined
			? this.defaultTokenExpiry(options.expiresInMs)
			: options.expiresAt;
		const tokenRecord = new this.TokenModel({
			userId,
			tokenHash: this.TokenModel.hashToken(token),
			name: options.name,
			ipAddress: options.ipAddress,
			userAgent: options.userAgent,
			browser: options.browser,
			operatingSystem: options.operatingSystem,
			device: options.device,
			expiresAt,
		}, {
			db: this.db.knex,
		});

		await tokenRecord.save();

		return {
			type: 'Bearer',
			token,
			expiresAt,
			user,
		};
	}

	/**
	 * Authenticates a bearer token and stores the matching identity on success.
	 *
	 * @param token - Plaintext bearer token.
	 * @param usage - Request metadata observed while authenticating the token.
	 * @returns Authenticated identity, or null when the token is invalid.
	 */
	async authenticateToken(token: string, usage: AuthTokenUsage = {}): Promise<TIdentity | null> {
		const tokenHash = this.TokenModel.hashToken(token);

		if (this.requestContext?.active) {
			const user = await this.requestContext.remember(
				this.tokenContextKey(tokenHash),
				() => this.authenticateTokenHash(tokenHash, usage),
			);

			if (user) {
				this.setAuthenticatedUser(user);
			} else {
				this.logout();
			}

			return user;
		}

		return this.authenticateTokenHash(tokenHash, usage);
	}

	/**
	 * Returns active bearer sessions belonging to a user.
	 *
	 * @param user - Account whose sessions should be listed.
	 * @returns Active, non-expired sessions ordered newest first.
	 */
	async tokensFor(user: TIdentity): Promise<AuthToken[]> {
		const userId = this.userPrimaryKey(user);

		if (!userId) return [];

		const tokens = await this.TokenModel
			.query(this.db.knex)
			.where('userId', userId)
			.whereNull('revokedAt')
			.orderBy('createdAt', 'desc')
			.all() as AuthToken[];

		return tokens.filter(token => token.isActive());
	}

	/**
	 * Revokes all bearer sessions for an account, including the current device.
	 *
	 * Apps must authorize the supplied account before calling this method. Tokens
	 * are rejected on subsequent requests; already-running requests can finish.
	 * Revoked rows are retained for audit. New sign-ins remain possible.
	 *
	 * @param user - Authorized account whose sessions should end.
	 * @returns Number of previously unrevoked token rows changed, including expired rows.
	 * @example
	 * await app.auth.revokeAllTokens(authenticatedUser);
	 */
	async revokeAllTokens(user: TIdentity): Promise<number> {
		const userId = this.userPrimaryKey(user);
		if (!userId) return 0;
		const count = await this.#revokeTokens(userId, this.db.knex);
		this.#forgetRevokedUser(userId);
		return count;
	}

	/**
	 * Revokes one bearer session owned by a user.
	 *
	 * @param user - Account that owns the session.
	 * @param tokenId - Auth token primary key.
	 * @returns True when an active session was revoked.
	 */
	async revokeToken(user: TIdentity, tokenId: string): Promise<boolean> {
		const userId = this.userPrimaryKey(user);

		if (!userId || !tokenId) return false;

		const token = await this.TokenModel
			.query(this.db.knex)
			.where('id', tokenId)
			.where('userId', userId)
			.first() as AuthToken | null;

		if (!token || !token.isActive()) return false;

		token.revoke();
		await token.save();

		return true;
	}

	/**
	 * Revokes the bearer session authenticated for the current request.
	 *
	 * @returns True when the current session was revoked.
	 */
	async revokeCurrentToken(): Promise<boolean> {
		const token = this.token;

		if (!token || !token.isActive()) return false;

		token.revoke();
		await token.save();
		this.logout();

		return true;
	}

	/**
	 * Builds the request-context key used to memoize bearer-token authentication.
	 *
	 * @param tokenHash - Hashed bearer token.
	 * @returns Request-context cache key.
	 */
	private tokenContextKey(tokenHash: string): string {
		const prefix = `${AUTH_TOKEN_CONTEXT_KEY_PREFIX}.${this.TokenModel.table}`;
		const revision = this.requestContext?.get<number>(`${prefix}.revision`) ?? 0;
		return `${prefix}.${revision}.${tokenHash}`;
	}

	/**
	 * Authenticates a pre-hashed bearer token against persistent auth records.
	 *
	 * @param tokenHash - Hashed bearer token.
	 * @returns Authenticated identity, or null when the token is invalid.
	 */
	private async authenticateTokenHash(
		tokenHash: string,
		usage: AuthTokenUsage,
	): Promise<TIdentity | null> {
		const tokenRecord = await this.TokenModel
			.query(this.db.knex)
			.where('tokenHash', tokenHash)
			.first() as AuthToken | null;

		if (!tokenRecord || !tokenRecord.isActive()) {
			this.logout();
			return null;
		}

		const user = await this.IdentityModel.findByPk(
			tokenRecord.userId,
			this.db.knex,
		);

		if (!user) {
			this.logout();
			return null;
		}

		tokenRecord.markUsed(new Date(), usage);
		await tokenRecord.save();
		this.setAuthenticatedToken(tokenRecord);
		await this.login(user);

		return user;
	}

	/**
	 * Marks a user model as authenticated.
	 *
	 * @param user - User to mark as authenticated.
	 * @returns The saved authenticated user.
	 */
	async login(user: TIdentity): Promise<TIdentity> {
		this.setAuthenticatedUser(user);
		user.setDb(this.db.knex);
		user.lastLoginAt = new Date();
		await user.save();
		return user;
	}

	/**
	 * Clears the authenticated user.
	 */
	logout(): void {
		this.setAuthenticatedUser(null);
		this.setAuthenticatedToken(null);
	}

	/**
	 * Returns the authenticated user or throws when auth is missing.
	 *
	 * @returns The current authenticated user.
	 */
	requireUser(): TIdentity {
		const user = this.user;

		if (!user) {
			throw new Error('No authenticated user.');
		}

		return user;
	}

	/**
	 * Verifies provider-specific input and normalizes the returned profile.
	 *
	 * @param provider - Configured provider name.
	 * @param input - Provider-specific credential payload.
	 * @param user - Current user when linking a provider.
	 * @returns Normalized provider profile, or null when verification fails.
	 */
	private async verifyProvider(
		provider: string,
		input: unknown,
		user: TIdentity | null,
	): Promise<auth.AuthProviderProfile | null> {
		const driver = this.requireProvider(provider);

		const profile = await ActiveRecord.withDb(this.db.knex, () => {
			return driver.verify(input);
		});

		if (!profile) return null;

		return {
			...profile,
			provider,
		};
	}

	/**
	 * Resolves a configured provider or throws a configuration error.
	 *
	 * @param provider - Provider name to resolve.
	 * @returns Provider configuration.
	 */
	private requireProvider(provider: string): auth.AuthProviderDriver<unknown, TIdentity> {
		if (!Object.prototype.hasOwnProperty.call(this.providerRegistry, provider)) {
			throw new AuthProviderNotConfiguredError(provider);
		}

		return this.providerRegistry[provider];
	}

	/**
	 * Resolves the configured password provider.
	 *
	 * @returns Password provider driver with password mutation helpers.
	 */
	private passwordProvider(): PasswordAuthProvider<TIdentity> {
		const provider = this.requireProvider(PASSWORD_AUTH_PROVIDER);

		if (!(provider instanceof PasswordAuthProvider)) {
			throw new AuthProviderNotConfiguredError(PASSWORD_AUTH_PROVIDER);
		}

		return provider;
	}

	/**
	 * Saves a verified provider profile onto a user account.
	 *
	 * @param user - User receiving the provider link.
	 * @param profile - Verified provider profile.
	 * @returns Saved provider row.
	 */
	private async saveLinkedProvider(
		user: TIdentity,
		profile: auth.AuthProviderProfile,
	): Promise<AuthProvider> {
		const existing = await this.findProvider(profile.provider, profile.providerUserId);
		const userId = this.userPrimaryKey(user);

		if (!userId) {
			throw new Error('Cannot link an auth provider to a user without an ID.');
		}

		if (existing && existing.userId !== userId) {
			throw new AuthIdentityExistsError('provider', `${profile.provider}:${profile.providerUserId}`);
		}

		const providerRecord = existing ?? new this.ProviderModel({}, {
			db: this.db.knex,
		});

		providerRecord.userId = userId;
		providerRecord.applyProfile(profile);
		await providerRecord.save();

		return providerRecord;
	}

	/**
	 * Finds a provider row by provider-owned identity.
	 *
	 * @param provider - Provider name.
	 * @param providerUserId - Provider-owned account id.
	 * @returns Matching provider row, or null.
	 */
	private async findProvider(
		provider: string,
		providerUserId: string,
	): Promise<AuthProvider | null> {
		return this.ProviderModel
			.query(this.db.knex)
			.where('provider', provider)
			.where('providerUserId', providerUserId)
			.first() as Promise<AuthProvider | null>;
	}

	/**
	 * Loads the user attached to a provider row.
	 *
	 * @param provider - Persisted provider row.
	 * @returns Linked identity, or null when missing.
	 */
	private async userForProvider(provider: AuthProvider): Promise<TIdentity | null> {
		if (!provider.userId) return null;

		return this.IdentityModel.findByPk(
			provider.userId,
			this.db.knex,
		);
	}

	/**
	 * Creates a user account from a verified external provider profile.
	 *
	 * @param profile - Verified provider profile.
	 * @returns Created identity, or null when no email is available.
	 */
	private async createIdentityForProvider(
		profile: auth.AuthProviderProfile,
	): Promise<TIdentity | null> {
		const email = profile.email ? normalizeIdentity(profile.email) : null;

		if (!email) return null;

		const existing = await this.findIdentity({
			[this.IdentityModel.identityField]: email,
		});

		if (existing) {
			throw new AuthIdentityExistsError(this.IdentityModel.identityField, email);
		}

		const user = new this.IdentityModel({
			name: profile.name || defaultNameForEmail(email),
			email,
			emailVerifiedAt: profile.emailVerifiedAt ?? null,
			avatarUrl: profile.avatarUrl ?? null,
		}, {
			db: this.db.knex,
		});

		await user.save();

		return user;
	}

	/**
	 * Backfills account-owned profile fields from a verified provider profile.
	 *
	 * Provider values are defaults only. Existing account values are preserved
	 * so a later user-selected avatar is not overwritten during provider login.
	 * The normal login save persists any backfilled values.
	 *
	 * @param user - Authenticated account receiving missing defaults.
	 * @param profile - Verified provider profile.
	 */
	private applyProviderProfileDefaults(
		user: TIdentity,
		profile: auth.AuthProviderProfile,
	): void {
		if (!user.avatarUrl && profile.avatarUrl) {
			user.avatarUrl = profile.avatarUrl;
		}
	}

	/**
	 * Stores the current authenticated user in request or fallback scope.
	 *
	 * @param user - User to expose as authenticated.
	 */
	private setAuthenticatedUser(user: TIdentity | null): void {
		if (this.requestContext?.active) {
			this.requestContext.set(AUTH_USER_CONTEXT_KEY, user);
			return;
		}

		this.fallbackAuthenticatedUser = user;
	}

	/**
	 * Stores the authenticated token in request or fallback scope.
	 *
	 * @param token - Token record to expose for session management.
	 */
	private setAuthenticatedToken(token: AuthToken | null): void {
		if (this.requestContext?.active) {
			this.requestContext.set(AUTH_TOKEN_RECORD_CONTEXT_KEY, token);
			return;
		}

		this.fallbackAuthenticatedToken = token;
	}

	/**
	 * Runs a callback with a temporary fallback user outside request scope.
	 *
	 * @param user - User to expose during the callback.
	 * @param callback - Work to run with the temporary user.
	 * @returns The callback result.
	 */
	private runWithFallbackUser<TResult>(
		user: TIdentity | null,
		callback: () => TResult,
	): TResult {
		const previousUser = this.fallbackAuthenticatedUser;

		this.fallbackAuthenticatedUser = user;

		try {
			const result = callback();

			if (isPromiseLike(result)) {
				return Promise.resolve(result).finally(() => {
					this.fallbackAuthenticatedUser = previousUser;
				}) as TResult;
			}

			this.fallbackAuthenticatedUser = previousUser;
			return result;
		} catch (error) {
			this.fallbackAuthenticatedUser = previousUser;
			throw error;
		}
	}

	/**
	 * Finds an identity by the configured identity field.
	 *
	 * @param input - Payload containing the configured identity value.
	 * @returns Matching identity, or null.
	 */
	private async findIdentity(input: Record<string, unknown>): Promise<TIdentity | null> {
		const identityField = this.IdentityModel.identityField;
		const identityValue = input[identityField];

		if (identityValue === undefined || identityValue === null) {
			return null;
		}

		return await this.IdentityModel
			.query(this.db.knex)
			.where(identityField, '=', identityValue)
			.first();
	}

	/**
	 * Checks whether password reset input belongs to the loaded user.
	 *
	 * @param input - Reset password payload.
	 * @param user - User loaded from the reset token.
	 * @returns True when the submitted identity is absent or matches the token user.
	 */
	private async passwordResetIdentityMatches(
		input: ResetPasswordInput,
		user: TIdentity,
	): Promise<boolean> {
		const identityField = this.IdentityModel.identityField;
		const inputIdentity = input[identityField];

		if (inputIdentity === undefined || inputIdentity === null || inputIdentity === '') {
			return true;
		}

		const inputUser = await this.IdentityModel.query()
			.where(identityField, inputIdentity).first();

		return inputUser?.get(this.IdentityModel.primaryKey) === user.get(this.IdentityModel.primaryKey);
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

	/**
	 * Reads the configured identity value from a payload.
	 *
	 * @param input - Payload to inspect.
	 * @returns Normalized identity value, or null when missing.
	 */
	private normalizedIdentity(input: Record<string, unknown>): string | null {
		return normalizeIdentity(input[this.IdentityModel.identityField]);
	}

	/**
	 * Calculates the default bearer token expiry.
	 *
	 * @param expiresInMs - Optional token lifetime override.
	 * @returns Absolute expiry time, or null for a non-expiring token.
	 */
	private defaultTokenExpiry(expiresInMs?: number | null): Date | null {
		const lifetime = expiresInMs === undefined
			? this.tokenLifetimeMs
			: expiresInMs;

		return lifetime === null
			? null
			: new Date(Date.now() + lifetime);
	}

	/**
	 * Calculates the default password reset token expiry.
	 *
	 * @param expiresInMs - Optional reset token lifetime override.
	 * @returns Absolute expiry time.
	 */
	private defaultPasswordResetTokenExpiry(expiresInMs?: number): Date {
		return new Date(Date.now() + (expiresInMs ?? this.passwordResetTokenLifetimeMs));
	}
}

/**
 * Normalizes an auth identity value for provider matching.
 *
 * @param value - Unknown identity value.
 * @returns Lowercase trimmed identity string, or null.
 */
function normalizeIdentity(value: unknown): string | null {
	if (typeof value !== 'string') return null;

	const normalized = value.trim().toLowerCase();

	return normalized || null;
}

/**
 * Builds a fallback display name from an email address.
 *
 * @param email - Normalized email address.
 * @returns Human-readable display name.
 */
function defaultNameForEmail(email: string): string {
	return email.replace(/@.+$/, '') || 'User';
}

/**
 * Provider driver with custom link behavior.
 *
 * Password uses this to link a password without first proving an existing
 * provider account.
 */
interface LinkableAuthProviderDriver<TIdentity extends UserIdentity = UserIdentity> extends auth.AuthProviderDriver<unknown, TIdentity> {
	/**
	 * Links this provider to an existing user.
	 *
	 * @param user - User receiving the provider.
	 * @param input - Provider-specific payload.
	 * @returns Saved provider row, or null when linking fails.
	 */
	link(
		user: TIdentity,
		input: unknown,
	): Promise<AuthProvider | null>;
}

/**
 * Checks whether a driver owns custom provider-link behavior.
 *
 * @param driver - Provider driver to inspect.
 * @returns True when a custom link method is available.
 */
function hasProviderLink<TIdentity extends UserIdentity>(
	driver: auth.AuthProviderDriver<unknown, TIdentity>,
): driver is LinkableAuthProviderDriver<TIdentity> {
	return typeof (driver as LinkableAuthProviderDriver<TIdentity>).link === 'function';
}
