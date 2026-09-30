/** SQL codes safe to include in an operator alert without SQL bindings. */
type AIRequestTrackingSqlCode = 'ER_LOCK_DEADLOCK' | 'ER_LOCK_WAIT_TIMEOUT';

/**
 * Reports that a pending AI request could not be saved before provider work.
 *
 * Database exceptions can contain SQL-bound prompts. This error deliberately
 * omits the original exception and exposes only an allowlisted code and stage.
 */
export class AIRequestTrackingError extends Error {
	readonly name = 'AIRequestTrackingError';
	/** The pending tracking write failed before any provider request was sent. */
	readonly stage = 'tracking:pending-request';
	/** Allowlisted database lock code, or null for another persistence failure. */
	readonly code: AIRequestTrackingSqlCode | null;

	/**
	 * Creates a payload-safe tracking failure from a database exception.
	 *
	 * @param error - Original persistence error; its message and SQL are discarded.
	 */
	constructor(error: unknown) {
		super('Unable to persist the pending AI request before provider execution.');
		this.code = trackingSqlCode(error);
	}
}

/**
 * Returns only database lock codes that are safe for structured diagnostics.
 *
 * @param error - Original persistence error, whose message is ignored.
 * @returns An allowlisted lock code or null.
 */
function trackingSqlCode(error: unknown): AIRequestTrackingSqlCode | null {
	if (!error || typeof error !== 'object' || !('code' in error)) return null;
	return error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT' ? error.code : null;
}
