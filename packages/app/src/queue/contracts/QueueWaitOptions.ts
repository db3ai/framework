/** Controls a cancellable idle wait without claiming or executing a job. */
export interface QueueWaitOptions {
	/** SQL/custom-driver polling delay in milliseconds. Defaults to 1000. */
	pollIntervalMs?: number;
	/** Maximum backend wait before a recovery check, in milliseconds. Defaults to 30000. */
	timeoutMs?: number;
	/** Cancels an idle wait during worker shutdown; cancellation resolves normally. */
	signal?: AbortSignal;
}
