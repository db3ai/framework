import type { UserIdentity } from '../UserIdentity';

/**
 * Normalized identity details returned by an authentication provider.
 *
 * Provider drivers translate their own proof mechanism into this shape. The
 * auth service owns persistence and session issuance after the driver proves
 * that the caller controls the provider account.
 */
export interface AuthProviderProfile {
	/**
	 * Stable provider name, such as `password`, `google`, or `magic_link`.
	 */
	provider: string;

	/**
	 * Stable provider-owned account id.
	 *
	 * For OAuth/OIDC providers this should be the provider subject/id, not an
	 * email address. The built-in password and magic-link providers use the
	 * normalized email address because the email inbox/account is the proof.
	 */
	providerUserId: string;

	/**
	 * Email address reported or proven by the provider.
	 */
	email?: string | null;

	/**
	 * When the provider proved the email address belongs to the user.
	 */
	emailVerifiedAt?: Date | null;

	/**
	 * Human-friendly provider account name.
	 */
	name?: string | null;

	/**
	 * Provider account avatar URL for account settings displays.
	 */
	avatarUrl?: string | null;

	/**
	 * Optional UI label for the linked provider row.
	 */
	label?: string | null;

	/**
	 * Safe provider metadata that callers may need to inspect later.
	 */
	profile?: Record<string, unknown> | null;
}

/**
 * Pluggable authentication provider driver.
 *
 * Drivers perform provider-specific verification. They should not create users
 * or sessions; provider-owned helpers may update provider rows when the auth
 * service explicitly calls them for flows such as password setup.
 */
export interface AuthProviderDriver<TInput = unknown, TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * Stable provider name used in `auth_providers.provider`.
	 */
	provider: string;

	/**
	 * Verifies provider-specific input and returns a normalized profile.
	 *
	 * @param input - Provider-specific credential payload.
	 * @returns Normalized provider profile, or null when verification fails.
	 */
	verify(input: TInput): Promise<AuthProviderProfile | null>;
}

/**
 * Object-style provider config read from the app config repository.
 */
export interface AuthProviderOptions {
	/**
	 * Built-in or custom driver name. Defaults to the provider key.
	 */
	driver?: string;

	/**
	 * Whether this provider should be registered. Defaults to true.
	 */
	enabled?: boolean;

	/**
	 * Provider-specific configuration values.
	 */
	[option: string]: unknown;
}

/**
 * Provider configuration accepted by the auth service.
 *
 * `true` enables a built-in provider such as `password`; driver instances
 * enable external or custom first-party providers.
 */
export type AuthProviderConfig<TIdentity extends UserIdentity = UserIdentity> =
	| true
	| false
	| AuthProviderOptions
	| AuthProviderDriver<unknown, TIdentity>;

/**
 * Map of provider names enabled for an app.
 */
export type AuthProviderRegistry<TIdentity extends UserIdentity = UserIdentity> =
	Record<string, AuthProviderConfig<TIdentity>>;
