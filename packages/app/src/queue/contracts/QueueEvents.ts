import type { QueueJobId, QueueJobOrigin } from './QueuePayload';
import type { QueueFailedJobRetryReference } from './QueueRetry';

/**
 * Lifecycle actions emitted as a durable queue job moves through the queue.
 */
export type QueueLifecycleAction =
	| 'dispatched'
	| 'claimed'
	| 'released'
	| 'deferred'
	| 'succeeded'
	| 'lease_lost'
	| 'failed';

/**
 * Immutable lifecycle event emitted after the corresponding queue transition.
 */
export interface QueueLifecycleEvent {
	/** Lifecycle transition represented by this event. */
	action: QueueLifecycleAction;
	/** UTC timestamp captured when the queue published the event. */
	timestamp: string;
	/** Named queue or channel containing the job. */
	queue: string;
	/** Durable job name used to resolve its handler. */
	jobName: string;
	/** Driver-owned queue record identifier. */
	jobId: QueueJobId;
	/** Stable UUID retained across every attempt for this queued job. */
	jobUuid: string;
	/** Number of processing attempts consumed at this transition. */
	attempts: number;
	/** Maximum processing attempts before terminal failure. */
	maxTries: number;
	/** Seconds before the next attempt is available, when applicable. */
	delaySeconds?: number;
	/** Handler duration for processing transitions, when measured. */
	durationMs?: number;
	/** Error that caused a release, deferral, or terminal failure. */
	error?: unknown;
	/** Framework-owned correlation metadata persisted with the queue envelope. */
	origin?: QueueJobOrigin;
	/** Terminal failure that was replayed to create this job, when applicable. */
	retryOf?: QueueFailedJobRetryReference;
	/** Application-owned job payload for opt-in diagnostic consumers. */
	payloadData: Record<string, unknown>;
}

/**
 * Synchronous or asynchronous consumer of queue lifecycle events.
 * Thrown errors and rejected promises are reported without rejecting queue work.
 */
export type QueueLifecycleListener = (
	event: QueueLifecycleEvent,
) => void | Promise<void>;

/**
 * Failure raised by a lifecycle listener or optional job hook.
 */
export interface QueueLifecycleFailure {
	/** Component that failed while observing an already-decided queue transition. */
	source: 'listener' | 'hook';
	/** Lifecycle event being observed when the failure occurred. */
	event: QueueLifecycleEvent;
	/** Optional QueueableJob hook that raised the failure. */
	hook?: 'onRetry' | 'onFinalFailure';
	/** Error raised by the listener or hook. */
	error: unknown;
}

/**
 * Reports non-fatal lifecycle listener and job-hook errors.
 */
export type QueueLifecycleErrorHandler = (
	failure: QueueLifecycleFailure,
) => void;
