/**
 * Error type that asks a queue worker to retry a job at a specific later time.
 *
 * Throw this for intentional external backpressure, such as provider rate limits,
 * where the job should remain queued without consuming an application retry.
 */
export class QueueRetryLaterError extends Error {
	/**
	 * Create a queue retry-later error.
	 *
	 * @param delaySeconds - Number of seconds before the job should be available.
	 * @param message - Human-readable reason for the deferral.
	 */
	constructor(
		readonly delaySeconds: number,
		message = 'Queue job should retry later.',
	) {
		super(message);
		this.name = 'QueueRetryLaterError';
	}
}

/**
 * Checks whether an unknown error asks the queue to defer without consuming a try.
 *
 * @param error - Unknown thrown value.
 * @returns True when the error carries a finite retry delay.
 */
export function isQueueRetryLaterError(error: unknown): error is QueueRetryLaterError {
	return (
		error instanceof QueueRetryLaterError
		|| (
			typeof error === 'object'
			&& error !== null
			&& (error as { name?: unknown }).name === 'QueueRetryLaterError'
			&& typeof (error as { delaySeconds?: unknown }).delaySeconds === 'number'
			&& Number.isFinite((error as { delaySeconds?: number }).delaySeconds)
		)
	);
}
