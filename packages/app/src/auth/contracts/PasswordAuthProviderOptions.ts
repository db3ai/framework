import type { AuthProvider } from '../AuthProvider';
import type { UserIdentity, UserIdentityModel } from '../UserIdentity';
import type { PasswordHash } from '../passwordHash';
import type { PasswordSuspensionOptions } from './PasswordSuspensionOptions';

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

	/**
	 * Failed-password suspension by normalized identity, including unknown identities.
	 * Enabled after 20 attempts by default; `false` disables it.
	 */
	suspension?: PasswordSuspensionOptions | false;
}
