import { isQueueableJob, isQueueableJobClass, queueableJobName, type QueueableJobContract as QueueableJob } from '../queue';
import type * as scheduler from './contracts';
import { ScheduledEvent } from './ScheduledEvent';

/**
 * Fluent daily schedule that creates a fresh QueueableJob when due.
 */
export class ScheduledJob extends ScheduledEvent {
	readonly kind = 'job' as const;

	/**
	 * Creates a scheduled job definition.
	 *
	 * @param source - Zero-argument QueueableJob class or fresh-job factory.
	 */
	constructor(
		private readonly source: scheduler.ScheduledJobSource,
	) {
		super();
	}

	/**
	 * Creates the QueueableJob for one claimed occurrence.
	 *
	 * @returns Fresh serializable queue job.
	 */
	createJob(): QueueableJob {
		const job = isQueueableJobClass(this.source)
			? new this.source()
			: this.source();

		if (!isQueueableJob(job)) {
			throw new Error(`Scheduled job "${this.resolvedName()}" did not create a QueueableJob.`);
		}

		return job;
	}

	/**
	 * Returns the class job name when no factory invocation is required.
	 *
	 * @returns Durable queue job name, or null for factories.
	 */
	override resolvedJobName(): string | null {
		if (!isQueueableJobClass(this.source)) return null;

		return queueableJobName(this.source);
	}

	/**
	 * Uses the durable class job name as the default schedule identity.
	 *
	 * @returns Default job name, or null for parameterised factories.
	 */
	protected override defaultName(): string | null {
		return this.resolvedJobName();
	}
}
