import type { QueueMonitor, QueueMonitorOptions } from '../queueMonitor';
import type { QueueEvents } from '../QueueEvents';
import type { QueueableJobContract as QueueableJob } from './QueueableJobContract';
import type { QueueLifecycleErrorHandler } from './QueueEvents';
import type { DispatchOptions, QueueDriverName, QueueJob, QueueJobId, QueueProcessResult } from './QueuePayload';
import type { QueueRetryBackoffStrategy } from './QueueRetry';
import type { QueueDriver, QueueFailedJob } from './QueueDriver';
import type { QueueableJobClass } from './QueueableJob';
import type { QueueWorkerLifecycle, QueueWorkerOptions } from './QueueWorkerLifecycle';
import type { RedisQueueDriverOptions } from './RedisQueueDriver';
import type { QueueJobRunner } from './QueueJobRunner';
import type { QueueWorkerSnapshot } from './QueueWorkerSnapshot';
import type { QueueSelection } from './QueueSelection';

/**
 * Function-style handler registered for a durable queued job name.
 */
export type JobHandler<TData = Record<string, unknown>> = (job: QueueJob<TData>) => Promise<void>;

/**
 * Input passed to a lazy job resolver when a worker sees an unknown job name.
 */
export interface QueueJobResolverContext {
	/** Durable queued job name from the persisted payload. */
	jobName: string;
}

/**
 * Resolves a queueable job class just in time for worker processing.
 */
export type QueueJobResolver = (
	context: QueueJobResolverContext,
) => QueueableJobClass | null | Promise<QueueableJobClass | null>;

/**
 * Queue service configuration shared by dispatching, processing, and worker startup.
 */
export interface QueueOptions {
	/** Receives serialized worker presence every ten seconds and on state changes; errors are isolated from job execution. */
	onWorkerHeartbeat?: (snapshot: QueueWorkerSnapshot) => void | Promise<void>;
	/**
	 * Default queue name used when dispatching or processing jobs without an explicit queue.
	 */
	queue?: string;
	/**
	 * Concrete queue driver instance, or the registered driver name to resolve lazily.
	 */
	driver?: QueueDriver | QueueDriverName;
	/**
	 * Named queue driver to resolve when no concrete driver instance is provided.
	 */
	driverName?: QueueDriverName;
	/**
	 * Redis driver options used when driver or driverName resolves to `redis`.
	 */
	redis?: RedisQueueDriverOptions;
	/**
	 * Number of seconds before an in-progress job is considered expired and claimable again.
	 */
	retryAfterSeconds?: number;
	/**
	 * Base delay, in seconds, used when releasing failed jobs for another attempt.
	 */
	retryDelaySeconds?: number;
	/**
	 * Default delay-growth strategy persisted on newly dispatched jobs.
	 */
	retryBackoffStrategy?: QueueRetryBackoffStrategy;
	/**
	 * Maximum delay, in seconds, persisted on newly dispatched jobs.
	 */
	retryMaxDelaySeconds?: number;
	/**
	 * Whether newly dispatched jobs apply equal jitter to ordinary retry delays.
	 */
	retryJitter?: boolean;
	/**
	 * Default polling interval, in milliseconds, for long-running workers.
	 */
	workerIntervalMs?: number;
	/**
	 * Maximum number of jobs a worker should process during one polling tick.
	 */
	maxJobsPerTick?: number;
	/**
	 * Enables or disables worker startup unless startWorker() is called with force.
	 */
	workerEnabled?: boolean;
	/**
	 * Configures queue lifecycle telemetry for development panels and tests.
	 */
	queueMonitor?: false | QueueMonitorOptions;
	/**
	 * Reports isolated lifecycle listener and QueueableJob hook failures.
	 */
	onLifecycleError?: QueueLifecycleErrorHandler;
	/**
	 * Lazily resolves a QueueableJob class when a worker sees an unknown job name.
	 */
	jobResolver?: QueueJobResolver;
}

/**
 * Hooks for observing a single job processing attempt.
 */
export interface QueueWorkOptions {
	/**
	 * Called after a driver claims a job and before the registered handler runs.
	 */
	onClaimed?(job: QueueJob): void;
}

/**
 * Public queue service API used by application code and queueable jobs.
 */
export interface QueueService {
	/** Registers an owned set of stable names and returns idempotent runtime cleanup. */
	registerJobs(owner: string, jobs: readonly QueueableJobClass[], run?: QueueJobRunner): () => void;
	/** Checks all active storage, including chained work; unsupported drivers reject rather than assume empty. */
	hasPendingJobs(jobPrefix: string): Promise<boolean>;
	/**
	 * Always-on asynchronous queue lifecycle event dispatcher.
	 */
	readonly events: QueueEvents;

	/**
	 * Queue lifecycle monitor attached to this service, when enabled.
	 */
	readonly queueMonitor: QueueMonitor | null;

	/**
	 * Returns recent terminal failures from driver-owned persistence.
	 *
	 * @param limit - Maximum number of recent failed jobs to return.
	 * @returns Recent failed jobs ordered from newest to oldest.
	 */
	failedJobs(limit?: number): Promise<QueueFailedJob[]>;

	/**
	 * Replays one persisted terminal failure as a new active queue job.
	 *
	 * The original failure remains available for audit and the replacement job
	 * receives a new UUID linked back to that failed record.
	 *
	 * @param id - Driver-owned failed-job record id.
	 * @param options - Optional queue, attempts, backoff, and delay overrides.
	 * @returns Queue driver id for the replacement job.
	 */
	retryFailed(id: QueueJobId, options?: DispatchOptions): Promise<QueueJobId>;

	/**
	 * Registers an async handler for a named job payload.
	 *
	 * @param name - Durable queued job name.
	 * @param handler - Handler invoked when a worker processes that job name.
	 */
	registerHandler<TData = Record<string, unknown>>(name: string, handler: JobHandler<TData>): void;

	/**
	 * Registers a queueable job class for worker rehydration.
	 *
	 * @param Job - Job class with JSON rehydration inherited from QueueableJob.
	 */
	registerJob<TJob extends QueueableJobClass>(Job: TJob): void;

	/**
	 * Dispatches a named job payload.
	 *
	 * @param job - Durable job name.
	 * @param data - JSON-safe payload data.
	 * @param options - Per-dispatch queue options.
	 * @returns Queue driver id for the queued job.
	 */
	dispatch<TData extends Record<string, unknown>>(job: string, data: TData, options?: DispatchOptions): Promise<QueueJobId>;

	/**
	 * Dispatches a queueable job instance.
	 *
	 * @param job - Queueable job instance to serialize and dispatch.
	 * @param options - Per-dispatch queue options.
	 * @returns Queue driver id for the queued job.
	 */
	dispatch<TJob extends QueueableJob>(job: TJob, options?: DispatchOptions): Promise<QueueJobId>;

	/**
	 * Dispatches queueable jobs in order, one after each successful predecessor.
	 *
	 * @param jobs - Serializable jobs to chain.
	 * @param options - Per-dispatch options for the first queued job.
	 * @returns Queue driver id for the first queued job.
	 */
	chain(jobs: QueueableJob[], options?: DispatchOptions): Promise<QueueJobId>;

	/**
	 * Dispatches queueable jobs independently.
	 *
	 * @param jobs - Serializable jobs to dispatch.
	 * @param options - Per-dispatch options applied to each job.
	 * @returns Queue driver ids for the queued jobs.
	 */
	batch(jobs: QueueableJob[], options?: DispatchOptions): Promise<QueueJobId[]>;

	/**
	 * Processes at most one available job from a named queue.
	 *
	 * @param queue - Named queue/channel to process.
	 * @returns True when a job was claimed and processed.
	 */
	processNextJob(queue?: string): Promise<boolean>;

	/**
	 * Processes at most one job and returns the detailed outcome.
	 *
	 * @param queue - Named queue/channel to process.
	 * @param options - Per-work hooks for the processing attempt.
	 * @returns Detailed result, or null when the queue was idle.
	 */
	workNextJob(queue?: string, options?: QueueWorkOptions): Promise<QueueProcessResult | null>;

	/**
	 * Discovers names with pending work in the configured driver namespace.
	 * @throws When the driver does not implement wildcard discovery.
	 */
	queueNames(): Promise<string[]>;

	/**
	 * Starts a polling worker for a named queue or round-robin selection.
	 *
	 * @param queue - Exact queue name or named-queue selection the worker should poll.
	 * @param options - Worker lifecycle and polling options.
	 * @returns Worker lifecycle controls, or null when worker startup is disabled.
	 */
	startWorker(queue?: string | QueueSelection, options?: QueueWorkerOptions): QueueWorkerLifecycle | null;
}
