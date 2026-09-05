import type { QueueableJob } from '../../queue';

/**
 * Supported scheduled task kinds.
 */
export type ScheduledTaskKind = 'job' | 'call';

/**
 * Durable lifecycle states recorded for one scheduled occurrence.
 */
export type ScheduledOccurrenceStatus =
	| 'claimed'
	| 'queued'
	| 'running'
	| 'retrying'
	| 'deferred'
	| 'succeeded'
	| 'failed';

/**
 * Daily frequency supported by the initial scheduler implementation.
 */
export interface DailyScheduleFrequency {
	/** Frequency discriminator reserved for future schedule types. */
	type: 'daily';
	/** Local wall-clock time in 24-hour HH:mm format. */
	time: string;
}

/**
 * Normalized public description of one registered schedule.
 */
export interface ScheduledTaskDefinition {
	/** Stable task name used for deduplication and history. */
	name: string;
	/** Whether the task dispatches a job or executes an inline callback. */
	kind: ScheduledTaskKind;
	/** Daily frequency and local wall-clock time. */
	frequency: DailyScheduleFrequency;
	/** IANA timezone used to interpret the frequency. */
	timezone: string;
	/** Durable queue job name when known without invoking a factory. */
	jobName?: string;
}

/**
 * Zero-argument QueueableJob class accepted directly by Scheduler.job().
 *
 * Jobs with constructor parameters must use a fresh-job factory instead.
 */
export interface ScheduledJobClass {
	/** Runtime class name used as the default durable schedule and queue name. */
	readonly name: string;
	/** Optional stable queue job name override. */
	readonly jobName?: string;
	/** Creates a fresh job without runtime constructor dependencies. */
	new(): QueueableJob;
	/**
	 * Rehydrates a queued instance from persisted job data.
	 *
	 * @param data - JSON-safe queue payload.
	 * @returns Rehydrated job instance.
	 */
	fromJSON(data: Record<string, unknown>): QueueableJob;
}

/**
 * Zero-argument class or fresh-job factory accepted by Scheduler.job().
 */
export type ScheduledJobSource =
	| ScheduledJobClass
	| (() => QueueableJob);

/**
 * Short synchronous or asynchronous callback accepted by Scheduler.call().
 */
export type ScheduledCallHandler = () => unknown | Promise<unknown>;

/**
 * Immediate scheduler failure raised while dispatching or running a due task.
 */
export interface SchedulerFailure {
	/** Stable schedule name that failed. */
	name: string;
	/** Human-readable failure message suitable for logs and CLI output. */
	error: string;
}

/**
 * Summary returned after evaluating all tasks for one UTC minute.
 */
export interface SchedulerRunResult {
	/** UTC minute evaluated by the scheduler. */
	evaluatedFor: Date;
	/** Time at which evaluation began. */
	startedAt: Date;
	/** Time at which evaluation finished. */
	finishedAt: Date;
	/** Registered definitions whose local schedule matched the minute. */
	due: number;
	/** Due occurrences atomically claimed by this scheduler process. */
	claimed: number;
	/** Claimed jobs successfully accepted by the queue. */
	dispatched: number;
	/** Claimed inline calls that completed successfully. */
	completed: number;
	/** Due occurrences already claimed by another process. */
	skipped: number;
	/** Immediate dispatch or inline-call failures. */
	failures: SchedulerFailure[];
}

/**
 * Logger used by scheduler workers and console adapters.
 */
export interface SchedulerLogger {
	/** Writes normal scheduler progress. */
	info(message: string): void;
	/** Writes slow-tick or recoverable scheduler warnings. */
	warn(message: string): void;
	/** Writes scheduler failures. */
	error(message: string, error?: unknown): void;
}
