/**
 * Persistent suspension policy for submitted password identities.
 *
 * Known and unknown emails share the same threshold. Only completed password
 * recovery clears suspension; this policy deliberately has no timed unlock.
 */
export interface PasswordSuspensionOptions {
	/** Consecutive failures before recovery is required. Defaults to 20. */
	maxFailedAttempts?: number;
}
