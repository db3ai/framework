import type { Queue } from '../Queue';
import type { QueueableJob } from '../QueueableJob';
import type { QueueJob, SerializedQueuedJob } from './QueuePayload';

/**
 * Serialized queueable job payload stored before a driver wraps it in an envelope.
 */
export type SerializedQueueableJob<TData extends Record<string, unknown> = Record<string, unknown>> = SerializedQueuedJob<TData>;

/**
 * Queue runtime metadata passed to a rehydrated job.
 */
export interface QueueableJobContext {
	/** Claimed queue job being handled. */
	job: QueueJob;
	/** Queue service that is processing this job. */
	queue: Queue;
}

/**
 * Context passed after a failed attempt has safely been released for retry.
 */
export interface QueueableJobRetryContext extends QueueableJobContext {
	/** Error raised by the failed handler attempt. */
	error: unknown;
	/** Seconds before the released job becomes available again. */
	delaySeconds: number;
}

/**
 * Context passed after a job exhausts its attempts and is durably failed.
 */
export interface QueueableJobFailureContext extends QueueableJobContext {
	/** Terminal error persisted by the queue driver. */
	error: unknown;
}

/**
 * Constructor contract for serializable queueable job classes.
 */
export interface QueueableJobClass<TJob extends QueueableJob = QueueableJob> {
	/** Runtime class name used as the default durable job name. */
	readonly name: string;
	/** Optional durable job name override. */
	readonly jobName?: string;
	/** Creates a job from its application-facing runtime data. */
	new(data: any): TJob;

	/**
	 * Rehydrates a queueable job instance from persisted payload data.
	 *
	 * @param data - JSON-safe data stored in the queue payload.
	 * @returns Queueable job instance ready to handle.
	 */
	fromJSON(data: Record<string, unknown>): TJob;
}
