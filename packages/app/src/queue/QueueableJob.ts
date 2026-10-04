import type * as queue from './contracts';

export type { QueueableJobClass, QueueableJobContext, QueueableJobFailureContext, QueueableJobRetryContext, SerializedQueueableJob } from './contracts';

/**
 * Base class for application jobs that serialize their runtime data through JSON.
 *
 * Normal jobs only need to declare their data type and implement `handle()`.
 * Override the constructor to validate or normalize input, and override
 * `fromJSON()` or `toJSON()` only when the default round trip is insufficient.
 */
export abstract class QueueableJob<TData extends Record<string, unknown> = Record<string, unknown>> {
	private chainedJobs: QueueableJob[] = [];

	/**
	 * Creates a queueable job from its JSON-safe runtime data.
	 *
	 * @param data - Data that will be persisted in the queue payload.
	 */
	constructor(readonly data: TData) {}

	/**
	 * Rehydrates a job by passing persisted JSON data to its constructor.
	 *
	 * Subclasses may override this for advanced serialization formats. Most jobs
	 * should validate or normalize data in their constructor instead.
	 *
	 * @param data - JSON-safe data restored from the queue payload.
	 * @returns Rehydrated job instance.
	 */
	static fromJSON<TJob extends QueueableJob>(
		this: new(data: any) => TJob,
		data: Record<string, unknown>,
	): TJob {
		return new this(data);
	}

	/**
	 * Attaches jobs that should run after this job completes successfully.
	 *
	 * @param jobs - Serializable jobs to dispatch one at a time after this job.
	 * @returns This job instance for fluent dispatching.
	 */
	chain(jobs: QueueableJob[]): this {
		this.chainedJobs = jobs;

		return this;
	}

	/**
	 * Serializes this job into the durable database queue payload shape.
	 *
	 * @returns Serialized queueable job envelope data.
	 */
	serialize(): queue.SerializedQueueableJob<TData> {
		const job = queueableJobName(this.constructor as queue.QueueableJobClass);
		const chainedJobs = this.chainedJobs.length > 0
			? this.chainedJobs
			: this.defaultChain();
		const chained = chainedJobs.map(chainedJob => chainedJob.serialize());

		return {
			job,
			displayName: job,
			data: this.toJSON(),
			...(chained.length ? { chained } : {}),
		};
	}

	/**
	 * Handles the job after the worker rehydrates it from queued data.
	 *
	 * @param context - Queueable job runtime context.
	 */
	abstract handle(context: queue.QueueableJobContext): Promise<void>;

	/**
	 * Handles a failed attempt after the queue has safely scheduled its retry.
	 *
	 * Hook failures are reported independently and do not change the retry.
	 *
	 * @param context - Queue metadata, failure, and retry delay.
	 */
	async onRetry(_context: queue.QueueableJobRetryContext): Promise<void> {}

	/**
	 * Handles terminal failure after the queue driver persists the failed job.
	 *
	 * Hook failures are reported independently and do not change the durable
	 * terminal outcome.
	 *
	 * @param context - Queue metadata and terminal error.
	 */
	async onFinalFailure(_context: queue.QueueableJobFailureContext): Promise<void> {}

	/**
	 * Returns the JSON-safe data stored as this queued job's payload data.
	 *
	 * @returns JSON payload data for this job.
	 */
	toJSON(): TData {
		return this.data;
	}

	/**
	 * Returns jobs that should follow this job when no explicit chain is set.
	 *
	 * @returns Queueable jobs to run after this job succeeds.
	 */
	protected defaultChain(): QueueableJob[] {
		return [];
	}
}

/**
 * Returns true when a value exposes the queueable-job serialization contract.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a queueable job instance.
 */
export function isQueueableJob(value: unknown): value is queue.QueueableJobContract {
	return Boolean(
		value
		&& typeof value === 'object'
		&& typeof (value as QueueableJob).serialize === 'function',
	);
}

/**
 * Returns true when a class looks like a QueueableJob subclass.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a queueable job class with JSON rehydration.
 */
export function isQueueableJobClass(value: unknown): value is queue.QueueableJobClass {
	if (typeof value !== 'function') return false;

	const prototype = value.prototype as Record<string, unknown> | undefined;

	return Boolean(
		prototype
		&& typeof prototype.serialize === 'function'
		&& typeof prototype.handle === 'function'
		&& typeof (value as queue.QueueableJobClass).fromJSON === 'function',
	);
}

/**
 * Resolves the durable queue name for a queueable job class.
 *
 * @param Job - Queueable job class or compatible class metadata.
 * @returns Durable queue job name.
 */
export function queueableJobName(Job: queue.QueueableJobClass | { name: string; jobName?: string }): string {
	return Job.jobName || Job.name;
}

/**
 * Rehydrates a queueable job instance from persisted JSON payload data.
 *
 * @param Job - Queueable job class that owns the payload data.
 * @param data - JSON payload data stored in the queue envelope.
 * @returns Rehydrated queueable job instance.
 */
export function queueableJobFromJSON(Job: queue.QueueableJobClass, data: Record<string, unknown>): queue.QueueableJobContract | Promise<queue.QueueableJobContract> {
	return Job.fromJSON(data);
}
