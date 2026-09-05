import type { QueueFailedJobRetryReference, QueueRetryBackoff, QueueRetryBackoffOptions } from './QueueRetry';

/**
 * Serialized form of a queueable job before it is wrapped in a durable queue envelope.
 *
 * Queueable jobs use this shape for object serialization and chained follow-up work.
 */
export interface SerializedQueuedJob<TData extends Record<string, unknown> = Record<string, unknown>> {
	/** Durable job name used to resolve the handler when a worker processes the payload. */
	job: string;
	/** Human-readable label shown in logs and queue monitors. */
	displayName?: string;
	/** JSON-safe payload data owned by the queued job. */
	data: TData;
	/** Remaining jobs that should run after this job succeeds. */
	chained?: SerializedQueuedJob[];
}

/**
 * Framework-owned correlation metadata attached to one root queue job.
 *
 * Origins let orchestration layers observe a queue job without adding their
 * identifiers to application-owned job payloads.
 */
export interface QueueJobOrigin {
	/** Framework subsystem that owns the correlated record. */
	type: string;
	/** Stable identifier understood by the originating subsystem. */
	id: string;
}

/**
 * Durable payload stored by queue drivers.
 *
 * Drivers persist this envelope as the canonical queue record payload. Application jobs
 * should treat `data` as their own payload and the other fields as framework metadata.
 */
export interface JobEnvelope<TData = Record<string, unknown>> {
	/** Stable UUID for this queued job attempt chain. */
	uuid: string;
	/** Human-readable label shown in logs and queue monitors. */
	displayName: string;
	/** Durable job name used to resolve the handler. */
	job: string;
	/** Maximum number of attempts before the job is moved to failed storage. */
	maxTries: number;
	/** Durable delay policy used when an ordinary failed attempt is released. */
	backoff?: QueueRetryBackoff;
	/** Absolute Unix timestamp after which another ordinary retry must not be scheduled. */
	retryUntil?: number;
	/** Application-owned JSON-safe payload data. */
	data: TData;
	/** Optional framework-owned record that originated this root queue job. */
	origin?: QueueJobOrigin;
	/** Terminal failed-job record that was replayed to create this job. */
	retryOf?: QueueFailedJobRetryReference;
	/** Remaining jobs that should be dispatched after this job succeeds. */
	chained?: SerializedQueuedJob[];
}

/**
 * Identifier returned by a queue driver when a job is persisted.
 */
export type QueueJobId = number | string;

/**
 * Built-in queue driver names understood by the framework.
 */
export type QueueDriverName = 'database' | 'redis';

/**
 * Claimed queue job passed to handlers and lifecycle hooks.
 */
export interface QueueJob<TData = Record<string, unknown>> {
	/** Driver-owned queue record id. */
	id: QueueJobId;
	/** Named queue/channel this job was claimed from. */
	queue: string;
	/** Number of processing attempts already consumed by this job. */
	attempts: number;
	/** Durable queue payload envelope. */
	payload: JobEnvelope<TData>;
}

/**
 * Per-dispatch overrides for queueing one job.
 */
export interface DispatchOptions {
	/**
	 * Named queue/channel the job should be pushed onto.
	 *
	 * Workers process one named queue at a time, so this lets callers route
	 * different classes of work to different worker pools. When omitted, the
	 * queue service uses its configured default queue name.
	 */
	queue?: string;

	/**
	 * Number of seconds to wait before the job becomes available to workers.
	 */
	delaySeconds?: number;

	/**
	 * Maximum number of processing attempts before the job is failed.
	 */
	maxTries?: number;

	/**
	 * Durable delay policy for ordinary failed attempts.
	 */
	backoff?: QueueRetryBackoffOptions;

	/**
	 * Maximum number of seconds ordinary retries may remain active after dispatch.
	 *
	 * Explicit QueueRetryLaterError deferrals own their own retry horizon and do
	 * not consume this ordinary-attempt window.
	 */
	retryUntilSeconds?: number;

	/**
	 * Framework-owned correlation metadata for this root queued job.
	 *
	 * Chained jobs do not inherit this value automatically because their
	 * lifecycle is distinct from the root dispatch.
	 */
	origin?: QueueJobOrigin;
}

/**
 * Result status for one queue processing attempt.
 *
 * `lease_lost` means the handler settled but the worker could not prove that its
 * exact attempt still owned the durable job, so no outcome transition was made.
 */
export type QueueProcessStatus = 'succeeded' | 'released' | 'deferred' | 'failed' | 'lease_lost';

/**
 * Detailed outcome returned after processing one claimed queue job.
 */
export interface QueueProcessResult {
	/** Claimed queue job that was processed. */
	job: QueueJob;
	/** Final status for this processing attempt. */
	status: QueueProcessStatus;
	/** Delay before a released or deferred job becomes available again. */
	delaySeconds?: number;
	/** Handler or lease error explaining why the attempt did not succeed. */
	error?: unknown;
}
