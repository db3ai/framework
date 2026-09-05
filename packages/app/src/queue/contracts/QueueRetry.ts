import type { QueueJobId } from './QueuePayload';

/**
 * Supported delay-growth strategies for ordinary queue retries.
 */
export type QueueRetryBackoffStrategy = 'linear' | 'exponential';

/**
 * Durable retry backoff stored with a queued job.
 *
 * Persisting this policy ensures every worker calculates the same retry schedule,
 * even when queue configuration changes after the job was dispatched.
 */
export interface QueueRetryBackoff {
	/** Delay-growth strategy applied after each consumed attempt. */
	strategy: QueueRetryBackoffStrategy;
	/** Base delay in seconds before the first retry. */
	initialSeconds: number;
	/** Maximum delay in seconds after applying the selected growth strategy. */
	maxSeconds: number;
	/** Whether equal jitter should be applied to reduce coordinated retry spikes. */
	jitter: boolean;
}

/**
 * Per-dispatch overrides used to build a durable retry backoff policy.
 */
export interface QueueRetryBackoffOptions {
	/** Delay-growth strategy applied after each consumed attempt. */
	strategy?: QueueRetryBackoffStrategy;
	/** Base delay in seconds before the first retry. */
	initialSeconds?: number;
	/** Maximum delay in seconds after applying the selected growth strategy. */
	maxSeconds?: number;
	/** Whether equal jitter should be applied to reduce coordinated retry spikes. */
	jitter?: boolean;
}

/**
 * Links a replayed queue job to the terminal failure that produced it.
 */
export interface QueueFailedJobRetryReference {
	/** Driver-owned failed-job record that was replayed. */
	failedJobId: QueueJobId;
	/** Stable UUID of the original terminally failed job. */
	jobUuid: string;
}
