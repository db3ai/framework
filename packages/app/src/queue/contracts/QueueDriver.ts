import type { JobEnvelope, QueueDriverName, QueueJob, QueueJobId } from './QueuePayload';

/**
 * Job data handed to a queue driver when a job is persisted.
 */
export interface QueueDriverPushInput<TData = Record<string, unknown>> {
	/** Named queue/channel the job should be pushed onto. */
	queue: string;
	/** Durable payload envelope to persist. */
	payload: JobEnvelope<TData>;
	/** Number of seconds before the job becomes available to workers. */
	delaySeconds: number;
	/** Unix timestamp used as the queue record creation time. */
	createdAt: number;
}

/**
 * Driver controls used when claiming the next available queue job.
 */
export interface QueueDriverPopOptions {
	/** Number of seconds before a reserved job is considered expired and claimable. */
	retryAfterSeconds: number;
}

/**
 * Terminal queue failure exposed by drivers that support persisted failure inspection.
 *
 * Queue monitoring uses this shape to hydrate recent failures without depending on
 * database models, Redis commands, or another driver-specific storage detail.
 */
export interface QueueFailedJob {
	/** Driver-owned failed-job record id. */
	id: QueueJobId;
	/** Driver or connection name that recorded the failure. */
	connection: string;
	/** Named queue/channel on which the job failed. */
	queue: string;
	/** Durable payload envelope stored for the failed job. */
	payload: JobEnvelope<Record<string, unknown>>;
	/** Stored exception message or stack trace. */
	exception: string;
	/** ISO timestamp at which the terminal failure was recorded. */
	failedAt: string;
}

/**
 * Durable storage contract used by the queue service.
 *
 * Drivers own persistence, claiming, releasing, deferring, deletion, and failed-job
 * recording. Queue owns handler execution and retry decisions.
 */
export interface QueueDriver {
	/** Inspects pending, delayed, reserved and chained work for maintenance; callers must quiesce producers first. */
	hasPendingJobs?(jobPrefix: string): Promise<boolean>;
	/** Driver name stored on failed job records and shown in diagnostics. */
	readonly name: QueueDriverName | string;

	/**
	 * Persists a job so a worker can claim it later.
	 *
	 * @param job - Queue job payload and scheduling data.
	 * @returns Driver-owned queued job id.
	 */
	push<TData extends Record<string, unknown>>(job: QueueDriverPushInput<TData>): Promise<QueueJobId>;

	/**
	 * Claims the next available job from a named queue.
	 *
	 * @param queue - Named queue/channel to claim from.
	 * @param options - Driver claim controls.
	 * @returns Claimed job or null when no job is available.
	 */
	pop(queue: string, options: QueueDriverPopOptions): Promise<QueueJob | null>;

	/**
	 * Extends the reservation for a claimed long-running job.
	 *
	 * @param job - Claimed queue job whose current attempt owns the lease.
	 * @param retryAfterSeconds - Number of seconds before the renewed lease expires.
	 * @returns True when the current attempt still owned and renewed the lease.
	 */
	touch(job: QueueJob, retryAfterSeconds: number): Promise<boolean>;

	/**
	 * Deletes a completed job when the current attempt still owns it.
	 *
	 * @param job - Claimed queue job to delete.
	 * @returns True when the current attempt owned and deleted the job.
	 */
	delete(job: QueueJob): Promise<boolean>;

	/**
	 * Releases an owned failed attempt while consuming the attempt.
	 *
	 * @param job - Claimed queue job to release.
	 * @param delaySeconds - Delay before the job can be claimed again.
	 * @returns True when the current attempt owned and released the job.
	 */
	release(job: QueueJob, delaySeconds: number): Promise<boolean>;

	/**
	 * Defers an owned job without consuming one of its retry attempts.
	 *
	 * @param job - Claimed queue job to defer.
	 * @param delaySeconds - Delay before the job can be claimed again.
	 * @returns True when the current attempt owned and deferred the job.
	 */
	defer(job: QueueJob, delaySeconds: number): Promise<boolean>;

	/**
	 * Records an owned terminal failure and removes it from the active queue.
	 *
	 * @param job - Claimed queue job that exhausted retries.
	 * @param error - Handler error that caused the terminal failure.
	 * @returns True when the current attempt owned and failed the job.
	 */
	fail(job: QueueJob, error: unknown): Promise<boolean>;

	/**
	 * Returns recent terminal failures when the driver supports persisted inspection.
	 *
	 * This optional capability keeps driver-specific failure storage behind the queue
	 * boundary while allowing development tooling to show failures from before startup.
	 *
	 * @param limit - Maximum number of recent failed jobs to return.
	 * @returns Recent failed jobs ordered from newest to oldest.
	 */
	failedJobs?(limit?: number): Promise<QueueFailedJob[]>;

	/**
	 * Returns one terminal failure by its driver-owned identifier.
	 *
	 * @param id - Driver-owned failed-job record id.
	 * @returns Persisted failed job, or null when no matching record exists.
	 */
	failedJob?(id: QueueJobId): Promise<QueueFailedJob | null>;
}
