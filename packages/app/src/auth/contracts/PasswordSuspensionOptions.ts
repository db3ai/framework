/**
 * Temporary suspension policy for submitted password identities.
 *
 * Known and unknown emails share the same threshold and cooldown. Verified
 * password recovery can clear a cooldown early.
 */
export interface PasswordSuspensionOptions {
	/** Consecutive failures before a temporary refusal. Defaults to 20. */
	maxFailedAttempts?: number;
	/** Refusal duration in milliseconds. Defaults to 15 minutes; maximum 24 hours. */
	durationMs?: number;
}
