import { AuthProvider, PASSWORD_AUTH_PROVIDER } from '../AuthProvider';
import type * as auth from '../contracts';
import type { PasswordHash } from '../passwordHash';
import type { UserIdentity, UserIdentityModel } from '../UserIdentity';
import { GOOGLE_AUTH_PROVIDER, GoogleAuthProvider, type GoogleAuthProviderOptions } from './GoogleAuthProvider';
import { PasswordAuthProvider } from './PasswordAuthProvider';

/**
 * Dependencies needed while constructing auth providers.
 */
export interface AuthProviderFactoryOptions<TIdentity extends UserIdentity = UserIdentity> {
	/**
	 * User identity model configured for the host app.
	 */
	identityModel: UserIdentityModel<TIdentity>;

	/**
	 * Provider-link model configured for the auth service.
	 */
	providerModel?: typeof AuthProvider;

	/**
	 * Password hashing service configured for the auth service.
	 */
	passwordHash: PasswordHash;
}

/**
 * Builds provider driver instances from app auth provider config.
 *
 * @param providers - Provider registry from explicit auth options or app config.
 * @param options - Construction dependencies shared by provider instances.
 * @returns Enabled provider driver instances keyed by provider name.
 */
export function resolveAuthProviders<TIdentity extends UserIdentity>(
	providers: auth.AuthProviderRegistry<TIdentity>,
	options: AuthProviderFactoryOptions<TIdentity>,
): Record<string, auth.AuthProviderDriver<unknown, TIdentity>> {
	const registry: Record<string, auth.AuthProviderDriver<unknown, TIdentity>> = {};

	for (const [provider, config] of Object.entries(providers)) {
		const driver = resolveAuthProvider(provider, config, options);

		if (driver) {
			registry[provider] = driver;
		}
	}

	return registry;
}

/**
 * Builds one provider driver from its config entry.
 *
 * @param provider - Provider registry key.
 * @param config - Provider config entry.
 * @param factoryOptions - Construction dependencies shared by provider instances.
 * @returns Provider driver, or null when disabled.
 */
function resolveAuthProvider<TIdentity extends UserIdentity>(
	provider: string,
	config: auth.AuthProviderConfig<TIdentity>,
	factoryOptions: AuthProviderFactoryOptions<TIdentity>,
): auth.AuthProviderDriver<unknown, TIdentity> | null {
	if (config === false) return null;
	if (isAuthProviderDriver<TIdentity>(config)) return config;

	const options = config === true
		? {}
		: config;

	if (options.enabled === false) return null;

	const driver = typeof options.driver === 'string'
		? options.driver
		: provider;

	switch (driver) {
		case PASSWORD_AUTH_PROVIDER:
			return new PasswordAuthProvider<TIdentity>({
				identityModel: factoryOptions.identityModel,
				providerModel: factoryOptions.providerModel,
				passwordHash: factoryOptions.passwordHash,
				suspension: options.suspension as auth.PasswordSuspensionOptions | false | undefined,
			}) as auth.AuthProviderDriver<unknown, TIdentity>;

		case GOOGLE_AUTH_PROVIDER:
			return new GoogleAuthProvider<TIdentity>(
				googleOptionsFromConfig(options),
			) as auth.AuthProviderDriver<unknown, TIdentity>;

		default:
			throw new Error(`Unknown auth provider driver "${driver}".`);
	}
}

/**
 * Checks whether a config entry is already a provider driver.
 *
 * @param value - Config value to inspect.
 * @returns True when the value satisfies the provider driver contract.
 */
function isAuthProviderDriver<TIdentity extends UserIdentity>(
	value: unknown,
): value is auth.AuthProviderDriver<unknown, TIdentity> {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as auth.AuthProviderDriver<unknown, TIdentity>).provider === 'string'
		&& typeof (value as auth.AuthProviderDriver<unknown, TIdentity>).verify === 'function';
}

/**
 * Converts generic config values into Google provider options.
 *
 * @param options - Generic provider config object.
 * @returns Google provider options.
 */
function googleOptionsFromConfig(options: auth.AuthProviderOptions): GoogleAuthProviderOptions {
	const {
		driver: _driver,
		enabled: _enabled,
		clientId,
		clientIds,
		hostedDomain,
		...rest
	} = options;

	return {
		...rest,
		clientId: stringOption(clientId),
		clientIds: stringArrayOption(clientIds),
		hostedDomain: stringOption(hostedDomain),
	} as GoogleAuthProviderOptions;
}

/**
 * Reads an optional string config value.
 *
 * @param value - Unknown config value.
 * @returns String value, or undefined.
 */
function stringOption(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim()
		? value.trim()
		: undefined;
}

/**
 * Reads an optional string array config value.
 *
 * @param value - Unknown config value.
 * @returns String array value.
 */
function stringArrayOption(value: unknown): string[] | undefined {
	if (typeof value === 'string') {
		return value
			.split(',')
			.map(item => item.trim())
			.filter(Boolean);
	}

	if (!Array.isArray(value)) return undefined;

	return value
		.map(item => stringOption(item))
		.filter((item): item is string => Boolean(item));
}
