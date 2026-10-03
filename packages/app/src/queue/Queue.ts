import { QueueTerminalError } from './QueueTerminalError';
import { randomUUID } from 'node:crypto';

import type { Database } from '../db';
import { DatabaseQueueDriver } from './drivers/DatabaseQueueDriver';
import { RedisQueueDriver } from './drivers/RedisQueueDriver';
import { enableDefaultQueueMonitor, type QueueMonitor } from './queueMonitor';
import { QueueEvents } from './QueueEvents';
import { queueRetryDeadlineReached, queueRetryDelaySeconds, queueRetryUntil, resolveQueueRetryBackoff, type QueueRetryBackoffDefaults } from './RetryPolicy';
import { QueueWorker } from './QueueWorker';
import { isQueueableJob, isQueueableJobClass, queueableJobFromJSON, queueableJobName, type QueueableJob } from './QueueableJob';
import { isQueueRetryLaterError } from './QueueRetryLaterError';
import type * as queue from './contracts';

export type { QueueOptions, QueueService, QueueWorkOptions } from './contracts';

/**
 * Prepared handler and optional failure hooks for one claimed queue job.
 */
interface QueueJobExecution {
	handle(): Promise<void>;
	onRetry?(error: unknown, delaySeconds: number): Promise<void>;
	onFinalFailure?(error: unknown): Promise<void>;
}

/**
 * Creates one execution whose hooks retain the same rehydrated job instance.
 */
type QueueJobExecutionFactory = (
	job: queue.QueueJob,
) => QueueJobExecution | Promise<QueueJobExecution>;

/**
 * Coordinates queue drivers, job handlers, dispatching, retries, and one-off processing.
 *
 * The Queue owns the durable job semantics. Long-running polling lives in QueueWorker so
 * callers can either process one job at a time or start a worker loop over the same API.
 */
export class Queue implements queue.QueueService {
	private readonly handlers = new Map<string, QueueJobExecutionFactory>();
	readonly #ownedJobs = new Map<string, { Job: queue.QueueableJobClass; run: queue.QueueJobRunner }>();
	private readonly driver: queue.QueueDriver;
	private readonly monitor: QueueMonitor | null;
	readonly events: QueueEvents;

	constructor(
		private readonly db: Database,
		private readonly options: queue.QueueOptions = {},
	) {
		this.driver = this.resolveDriver();
		this.events = new QueueEvents(failure => {
			this.reportLifecycleFailure(failure);
		});
		this.monitor = enableDefaultQueueMonitor(this.options.queueMonitor);

		if (this.monitor) {
			this.events.subscribe(event => {
				this.monitor?.recordLifecycleEvent(event);
			});
		}
	}

	/**
	 * Returns the queue lifecycle monitor attached to this queue, when enabled.
	 */
	get queueMonitor(): QueueMonitor | null {
		return this.monitor;
	}

	/** Registers app-owned stable job names atomically and returns cleanup for this process only. */
	registerJobs(owner: string, jobs: readonly queue.QueueableJobClass[], run: queue.QueueJobRunner = operation => operation()): () => void {
		if (!/^[a-z][a-z0-9_]{0,39}$/.test(owner)) throw new Error('Invalid queue job owner.');
		const names = new Set<string>();
		for (const Job of jobs) {
			const name = queueableJobName(Job);
			if (!isQueueableJobClass(Job) || !Job.jobName?.startsWith(`${owner}.`) || names.has(name) || this.handlers.has(name)) throw new Error(`Invalid or duplicate owned job "${name}"; use an explicit ${owner}. jobName.`);
			names.add(name);
		}
		for (const Job of jobs) { this.registerJob(Job); this.#ownedJobs.set(queueableJobName(Job), { Job, run }); }
		let closed = false;
		return () => {
			if (closed) return;
			closed = true;
			for (const name of names) { this.handlers.delete(name); this.#ownedJobs.delete(name); }
		};
	}

	/** Checks active, delayed, reserved and chained payloads after producers have been quiesced. */
	async hasPendingJobs(jobPrefix: string): Promise<boolean> {
		if (!jobPrefix.trim()) throw new Error('A non-empty job prefix is required.');
		if (!this.driver.hasPendingJobs) throw new Error(`Queue driver "${this.driver.name}" cannot inspect outstanding app work.`);
		return this.driver.hasPendingJobs(jobPrefix);
	}

	/**
	 * Returns recent terminal failures from the configured queue driver.
	 *
	 * Drivers without persisted failure inspection return an empty collection so
	 * development tooling can use one queue-level API without knowing the driver.
	 *
	 * @param limit - Maximum number of recent failed jobs to return.
	 * @returns Recent failed jobs ordered from newest to oldest.
	 */
	async failedJobs(limit = 100): Promise<queue.QueueFailedJob[]> {
		if (!this.driver.failedJobs) return [];

		return await this.driver.failedJobs(limit);
	}

	/**
	 * Replays one terminal failure as a new active queue job.
	 *
	 * The failed record remains untouched for audit. The replacement receives a
	 * new UUID and a retry reference to the original failure.
	 *
	 * @param id - Driver-owned failed-job record id.
	 * @param options - Optional dispatch overrides for the replacement job.
	 * @returns Queue driver id for the replacement job.
	 */
	async retryFailed(
		id: queue.QueueJobId,
		options: queue.DispatchOptions = {},
	): Promise<queue.QueueJobId> {
		if (!this.driver.failedJob) {
			throw new Error(`Queue driver "${this.driver.name}" does not support failed-job replay.`);
		}

		const failed = await this.driver.failedJob(id);

		if (!failed) {
			throw new Error(`Failed queue job "${String(id)}" was not found.`);
		}

		return await this.pushJob(
			failed.payload.job,
			failed.payload.data,
			{
				...options,
				queue: options.queue ?? failed.queue,
				maxTries: options.maxTries ?? failed.payload.maxTries,
				backoff: options.backoff ?? failed.payload.backoff,
				origin: options.origin ?? failed.payload.origin,
			},
			failed.payload.displayName,
			failed.payload.chained ?? [],
			{
				failedJobId: failed.id,
				jobUuid: failed.payload.uuid,
			},
		);
	}

	/**
	 * Registers an async handler for a named job payload.
	 */
	registerHandler<TData = Record<string, unknown>>(
		name: string,
		handler: queue.JobHandler<TData>,
	): void {
		if (this.#ownedJobs.has(name)) throw new Error(`Job "${name}" belongs to an owned registration.`);
		this.handlers.set(name, job => {
			return {
				handle: () => handler(job as queue.QueueJob<TData>),
			};
		});
	}

	/**
	 * Registers a queueable job class by rehydrating it for each queued payload.
	 *
	 * @param Job - Queueable job class to register.
	 */
	registerJob<TJob extends queue.QueueableJobClass>(Job: TJob): void {
		if (!isQueueableJobClass(Job)) {
			throw new Error('Queue.registerJob requires a QueueableJob class.');
		}

		const owned = this.#ownedJobs.get(queueableJobName(Job));
		if (owned) {
			if (owned.Job !== Job) throw new Error(`Job "${queueableJobName(Job)}" belongs to another registration.`);
			return;
		}
		this.handlers.set(queueableJobName(Job), job => {
			const instance = queueableJobFromJSON(Job, job.payload.data);
			const context = this.createQueueableJobContext(job);

			return {
				handle: () => instance.handle(context),
				onRetry: (error, delaySeconds) => instance.onRetry({
					...context,
					error,
					delaySeconds,
				}),
				onFinalFailure: error => instance.onFinalFailure({
					...context,
					error,
				}),
			};
		});
	}

	/**
	 * Pushes a job payload to the configured driver.
	 *
	 * Queueable job instances are auto-registered on first dispatch in the current process.
	 */
	async dispatch<TData extends Record<string, unknown>>(
		job: string,
		data: TData,
		options?: queue.DispatchOptions,
	): Promise<queue.QueueJobId>;
	async dispatch<TJob extends QueueableJob>(
		job: TJob,
		options?: queue.DispatchOptions,
	): Promise<queue.QueueJobId>;
	async dispatch(
		job: string | QueueableJob,
		dataOrOptions: Record<string, unknown> | queue.DispatchOptions = {},
		maybeOptions: queue.DispatchOptions = {},
	): Promise<queue.QueueJobId> {
		const serialized = isQueueableJob(job) ? job.serialize() : null;
		const name = resolveDispatchedJobName(job, serialized?.job);
		const options = serialized ? dataOrOptions as queue.DispatchOptions : maybeOptions;

		if (serialized) {
			if (!this.handlers.has(name)) {
				this.registerJob(job.constructor as queue.QueueableJobClass);
			}

			return await this.dispatchSerializedJob(serialized, options);
		}

		const data = dataOrOptions as Record<string, unknown>;

		return await this.pushJob(name, data, options);
	}

	/**
	 * Dispatches the first job in a serialized chain.
	 *
	 * @param jobs - Serializable jobs to run in order.
	 * @param options - Dispatch options for the first job.
	 * @returns Queue id for the first queued job.
	 */
	async chain(jobs: QueueableJob[], options: queue.DispatchOptions = {}): Promise<queue.QueueJobId> {
		const [firstJob, ...remainingJobs] = jobs;

		if (!firstJob) {
			throw new Error('Queue.chain requires at least one job.');
		}

		if (!this.handlers.has(queueableJobName(firstJob.constructor as queue.QueueableJobClass))) {
			this.registerJob(firstJob.constructor as queue.QueueableJobClass);
		}

		return await this.dispatchSerializedJob(
			firstJob.serialize(),
			options,
			remainingJobs.map(job => job.serialize()),
		);
	}

	/**
	 * Dispatches several queueable jobs independently.
	 *
	 * @param jobs - Serializable jobs to dispatch.
	 * @param options - Dispatch options applied to each job.
	 * @returns Queue ids for the dispatched jobs.
	 */
	async batch(jobs: QueueableJob[], options: queue.DispatchOptions = {}): Promise<queue.QueueJobId[]> {
		const ids: queue.QueueJobId[] = [];

		for (const job of jobs) {
			ids.push(await this.dispatch(job, options));
		}

		return ids;
	}

	/**
	 * Processes at most one available job and returns whether any work was handled.
	 */
	async processNextJob(queue = this.options.queue || 'default'): Promise<boolean> {
		return (await this.workNextJob(queue)) !== null;
	}

	/**
	 * Claims one job, runs its handler, and records the resulting success, retry, or failure.
	 */
	async workNextJob(
		queue = this.options.queue || 'default',
		options: queue.QueueWorkOptions = {},
	): Promise<queue.QueueProcessResult | null> {
		const retryAfterSeconds = this.retryAfterSeconds();
		const job = await this.driver.pop(queue, {
			retryAfterSeconds,
		});

		if (!job) return null;

		const owned = this.#ownedJobs.get(job.payload.job);
		if (!owned) return this.#workClaimedJob(job, retryAfterSeconds, options);
		let entered = false;
		try {
			return await owned.run(async () => { entered = true; return this.#workClaimedJob(job, retryAfterSeconds, options); });
		} catch (error) {
			if (entered) throw error;
			// Admission was refused before app code ran. Retain the job without consuming an attempt.
			if (!(await this.driver.defer(job, 30))) return this.recordLostLease(job, performance.now(), this.lostLeaseError(job, 'defer'));
			const deferred = { ...job, attempts: Math.max(0, job.attempts - 1) };
			await this.publishJobEvent('deferred', deferred, { delaySeconds: 30, error });
			return { job: deferred, status: 'deferred', delaySeconds: 30, error };
		}
	}

	/** Processes an already claimed job and completes its durable transition and hooks before releasing ownership. */
	async #workClaimedJob(job: queue.QueueJob, retryAfterSeconds: number, options: queue.QueueWorkOptions): Promise<queue.QueueProcessResult> {
		options.onClaimed?.(job);
		await this.publishJobEvent('claimed', job);

		let execution: QueueJobExecution | null = null;
		const startedAt = performance.now();
		const stopLeaseHeartbeat = this.startLeaseHeartbeat(job, retryAfterSeconds);

		try {
			const factory = await this.handlerForJob(job.payload.job);

			if (!factory) {
				throw new Error(`No handler registered for queued job "${job.payload.job}".`);
			}

			execution = await factory(job);
			await execution.handle();
			await stopLeaseHeartbeat();
			const leaseError = await this.confirmLease(job, retryAfterSeconds, 'complete');

			if (leaseError) {
				return await this.recordLostLease(job, startedAt, leaseError);
			}

			await this.dispatchNextChainedJob(job);
			const completed = await this.driver.delete(job);

			if (!completed) {
				return await this.recordLostLease(
					job,
					startedAt,
					this.lostLeaseError(job, 'complete'),
				);
			}

			await this.publishJobEvent('succeeded', job, {
				durationMs: performance.now() - startedAt,
			});

			return {
				job,
				status: 'succeeded',
			};
		} catch (error) {
			await stopLeaseHeartbeat();
			const leaseError = await this.confirmLease(job, retryAfterSeconds, 'transition');

			if (leaseError) {
				return await this.recordLostLease(job, startedAt, leaseError);
			}

			if (isQueueRetryLaterError(error)) {
				const delaySeconds = Math.max(0, Math.ceil(error.delaySeconds));
				const deferredJob = {
					...job,
					attempts: Math.max(0, job.attempts - 1),
				};

				const deferred = await this.driver.defer(job, delaySeconds);

				if (!deferred) {
					return await this.recordLostLease(
						job,
						startedAt,
						this.lostLeaseError(job, 'defer'),
					);
				}

				await this.publishJobEvent('deferred', deferredJob, {
					delaySeconds,
					durationMs: performance.now() - startedAt,
					error,
				});

				return {
					job: deferredJob,
					status: 'deferred',
					delaySeconds,
					error,
				};
			}

			const delaySeconds = queueRetryDelaySeconds(
				job.payload.backoff ?? this.resolveRetryBackoff(),
				job.attempts,
			);
			const retryDeadlineReached = queueRetryDeadlineReached(
				job.payload.retryUntil,
				delaySeconds,
				unixTimestamp(),
			);

			if (error instanceof QueueTerminalError || job.attempts >= job.payload.maxTries || retryDeadlineReached) {
				const failed = await this.driver.fail(job, error);

				if (!failed) {
					return await this.recordLostLease(
						job,
						startedAt,
						this.lostLeaseError(job, 'fail'),
					);
				}

				const event = await this.publishJobEvent('failed', job, {
					durationMs: performance.now() - startedAt,
					error,
				});
				await this.runJobHook(execution, 'onFinalFailure', event, error);

				return {
					job,
					status: 'failed',
					error,
				};
			}

			const released = await this.driver.release(job, delaySeconds);

			if (!released) {
				return await this.recordLostLease(
					job,
					startedAt,
					this.lostLeaseError(job, 'release'),
				);
			}

			const event = await this.publishJobEvent('released', job, {
				delaySeconds,
				durationMs: performance.now() - startedAt,
				error,
			});
			await this.runJobHook(execution, 'onRetry', event, error, delaySeconds);

			return {
				job,
				status: 'released',
				delaySeconds,
				error,
			};
		}
	}

	/**
	 * Periodically renews a claimed job while its handler is still running.
	 *
	 * @param job - Claimed queue job.
	 * @param retryAfterSeconds - Driver lease duration in seconds.
	 * @returns Async stop function that also waits for an in-flight renewal.
	 */
	private startLeaseHeartbeat(
		job: queue.QueueJob,
		retryAfterSeconds: number,
	): () => Promise<void> {
		const intervalMs = Math.max(1000, Math.floor(retryAfterSeconds * 1000 / 3));
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let inFlight: Promise<void> | null = null;

		/**
		 * Renews the current lease once and schedules the next heartbeat.
		 */
		const renew = async (): Promise<void> => {
			if (stopped) return;

			inFlight = this.driver.touch(job, retryAfterSeconds)
				.then((renewed): void => {
					if (!renewed) {
						stopped = true;
						console.error(
							`[queue] Lost lease for ${job.payload.job} job ${String(job.id)} attempt ${job.attempts}.`,
						);
					}
				})
				.catch((error): void => {
					console.error(
						`[queue] Failed to renew lease for ${job.payload.job} job ${String(job.id)}.`,
						error,
					);
				});

			await inFlight;
			inFlight = null;

			if (!stopped) {
				timer = setTimeout(renew, intervalMs);
			}
		};

		timer = setTimeout(renew, intervalMs);

		/**
		 * Stops future heartbeats and waits for the current renewal to settle.
		 */
		return async (): Promise<void> => {
			stopped = true;

			if (timer) {
				clearTimeout(timer);
				timer = null;
			}

			await inFlight;
		};
	}

	/**
	 * Renews a lease immediately before committing an attempt outcome.
	 *
	 * A final renewal is both an ownership check and a fresh fencing window for
	 * the short transition that follows. Renewal errors are treated as unknown
	 * ownership so the worker leaves the durable record for safe recovery.
	 *
	 * @param job - Claimed queue job.
	 * @param retryAfterSeconds - Driver lease duration in seconds.
	 * @param operation - Outcome the worker intends to commit.
	 * @returns Null when ownership is confirmed, otherwise a lease error.
	 */
	private async confirmLease(
		job: queue.QueueJob,
		retryAfterSeconds: number,
		operation: string,
	): Promise<Error | null> {
		try {
			const renewed = await this.driver.touch(job, retryAfterSeconds);

			return renewed
				? null
				: this.lostLeaseError(job, operation);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			return this.lostLeaseError(job, operation, message);
		}
	}

	/**
	 * Records that a stale attempt stopped before changing newer queue state.
	 *
	 * @param job - Claimed job whose lease could not be confirmed.
	 * @param startedAt - Monotonic handler start time.
	 * @param error - Error describing the rejected transition.
	 * @returns Lease-lost queue result for worker logging.
	 */
	private async recordLostLease(
		job: queue.QueueJob,
		startedAt: number,
		error: Error,
	): Promise<queue.QueueProcessResult> {
		await this.publishJobEvent('lease_lost', job, {
			durationMs: performance.now() - startedAt,
			error,
		});

		return {
			job,
			status: 'lease_lost',
			error,
		};
	}

	/**
	 * Creates a consistent error for one rejected attempt transition.
	 *
	 * @param job - Claimed queue job.
	 * @param operation - Transition rejected by lease fencing.
	 * @param detail - Optional driver error explaining unknown ownership.
	 * @returns Lease ownership error suitable for monitoring and logs.
	 */
	private lostLeaseError(
		job: queue.QueueJob,
		operation: string,
		detail?: string,
	): Error {
		if (detail) {
			return new Error(
				`Could not confirm queue attempt ${job.attempts} still owns ${job.payload.job} job ${String(job.id)}; refused to ${operation}. Driver error: ${detail}`,
			);
		}

		return new Error(
			`Queue attempt ${job.attempts} no longer owns ${job.payload.job} job ${String(job.id)}; refused to ${operation}.`,
		);
	}

	/**
	 * Discovers named queues without reading or changing job payloads.
	 * @throws When a custom driver does not implement wildcard discovery.
	 */
	async queueNames(): Promise<string[]> {
		if (!this.driver.queueNames) throw new Error(`Queue driver "${this.driver.name}" does not support wildcard queue discovery.`);
		return this.driver.queueNames();
	}

	/**
	 * Starts a polling worker for a named queue or selection unless disabled.
	 * @example queue.startWorker({ queues: '*', excludeQueues: ['articles'] });
	 */
	startWorker(
		queue: string | queue.QueueSelection = process.env.QUEUE_NAME || this.options.queue || 'default',
		options: queue.QueueWorkerOptions = {},
	): QueueWorker | null {
		if (this.workerDisabled() && !options.force) return null;

		const worker = new QueueWorker(
			this,
			typeof queue === 'string' ? queue : { ...queue, queues: queue.queues ?? [this.options.queue || 'default'] },
			options.intervalMs ?? this.workerIntervalMs(),
			options.maxJobsPerTick ?? this.maxJobsPerTick(),
			options.logger,
			options.verbose ?? false,
		);

		worker.start();

		return worker;
	}

	private resolveDriver(): queue.QueueDriver {
		if (this.options.driver && typeof this.options.driver !== 'string') {
			return this.options.driver;
		}

		const driverName = this.options.driver
			|| this.options.driverName
			|| queueDriverFromEnv();

		if (driverName === 'database') {
			return new DatabaseQueueDriver(this.db);
		}

		if (driverName === 'redis') {
			return new RedisQueueDriver(this.options.redis);
		}

		throw new Error(`Unsupported queue driver "${driverName}".`);
	}

	/**
	 * Returns a positive reservation timeout for queue claims and heartbeats.
	 *
	 * @returns Queue lease duration in whole seconds.
	 */
	private retryAfterSeconds(): number {
		const configured = this.options.retryAfterSeconds
			?? Number(process.env.QUEUE_RETRY_AFTER_SECONDS || 90);

		if (!Number.isFinite(configured) || configured <= 0) return 90;

		return Math.max(1, Math.trunc(configured));
	}

	/**
	 * Resolves the durable backoff stored on a newly dispatched job.
	 *
	 * @param options - Optional per-dispatch backoff overrides.
	 * @returns Complete validated retry backoff.
	 */
	private resolveRetryBackoff(
		options?: queue.QueueRetryBackoffOptions,
	): queue.QueueRetryBackoff {
		const configuredStrategy = this.options.retryBackoffStrategy
			?? retryBackoffStrategyFromEnv();
		const defaults: QueueRetryBackoffDefaults = {
			strategy: configuredStrategy,
			initialSeconds: this.options.retryDelaySeconds
				?? Number(process.env.QUEUE_RETRY_DELAY_SECONDS || 15),
			maxSeconds: this.options.retryMaxDelaySeconds
				?? Number(process.env.QUEUE_RETRY_MAX_DELAY_SECONDS || 3600),
			jitter: this.options.retryJitter
				?? booleanFromEnv('QUEUE_RETRY_JITTER', false),
		};

		return resolveQueueRetryBackoff(options, defaults);
	}

	private workerIntervalMs(): number {
		return this.options.workerIntervalMs
			?? Number(process.env.QUEUE_WORKER_INTERVAL_MS || 1000);
	}

	private maxJobsPerTick(): number {
		return this.options.maxJobsPerTick
			?? Number(process.env.QUEUE_WORKER_MAX_JOBS_PER_TICK || 5);
	}

	private workerDisabled(): boolean {
		if (this.options.workerEnabled !== undefined) {
			return !this.options.workerEnabled;
		}

		return process.env.QUEUE_WORKER === 'false';
	}

	/**
	 * Builds the runtime context passed to a rehydrated queueable job.
	 */
	private createQueueableJobContext(job: queue.QueueJob): queue.QueueableJobContext {
		return {
			job,
			queue: this,
		};
	}

	/**
	 * Returns a registered handler, resolving a conventional job class when possible.
	 */
	private async handlerForJob(jobName: string): Promise<QueueJobExecutionFactory | null> {
		const existing = this.handlers.get(jobName);

		if (existing) return existing;
		if (!this.options.jobResolver) return null;

		const resolved = await this.options.jobResolver({
			jobName,
		});

		if (!resolved) return null;

		this.registerJob(resolved);

		return this.handlers.get(jobName) ?? null;
	}

	/**
	 * Pushes a serialized queueable job to the driver.
	 *
	 * @param serialized - Serialized queueable job payload.
	 * @param options - Dispatch options for this queued job.
	 * @param chained - Optional chain tail to attach to this queued job.
	 * @returns Queue id for the pushed job.
	 */
	private async dispatchSerializedJob(
		serialized: queue.SerializedQueuedJob,
		options: queue.DispatchOptions,
		chained: queue.SerializedQueuedJob[] = serialized.chained ?? [],
	): Promise<queue.QueueJobId> {
		return await this.pushJob(
			serialized.job,
			serialized.data,
			options,
			serialized.displayName,
			chained,
		);
	}

	/**
	 * Dispatches the next job from a completed job chain.
	 *
	 * @param job - Successfully handled queue job.
	 */
	private async dispatchNextChainedJob(job: queue.QueueJob): Promise<void> {
		const [nextJob, ...remainingJobs] = job.payload.chained ?? [];

		if (!nextJob) return;

		await this.dispatchSerializedJob(nextJob, {
			queue: job.queue,
			maxTries: job.payload.maxTries,
			backoff: job.payload.backoff,
		}, remainingJobs);
	}

	/**
	 * Creates and pushes the durable queue envelope.
	 *
	 * @param name - Queue job name.
	 * @param data - JSON-safe job payload data.
	 * @param options - Dispatch options.
	 * @param displayName - Optional human-readable display name.
	 * @param chained - Serialized jobs to run after this job succeeds.
	 * @param retryOf - Optional terminal failure replayed to create this job.
	 * @returns Queue id returned by the driver.
	 */
	private async pushJob(
		name: string,
		data: Record<string, unknown>,
		options: queue.DispatchOptions,
		displayName: string = name,
		chained: queue.SerializedQueuedJob[] = [],
		retryOf?: queue.QueueFailedJobRetryReference,
	): Promise<queue.QueueJobId> {
		const now = unixTimestamp();
		const retryUntil = queueRetryUntil(now, options.retryUntilSeconds);
		const payload: queue.JobEnvelope<Record<string, unknown>> = {
			uuid: randomUUID(),
			displayName,
			job: name,
			maxTries: positiveInteger(options.maxTries, 3),
			backoff: this.resolveRetryBackoff(options.backoff),
			...(retryUntil ? { retryUntil } : {}),
			data,
			...(options.origin ? { origin: options.origin } : {}),
			...(retryOf ? { retryOf } : {}),
			...(chained.length ? { chained } : {}),
		};
		const queue = options.queue || this.options.queue || 'default';
		const delaySeconds = options.delaySeconds || 0;

		const jobId = await this.driver.push({
			queue,
			payload,
			delaySeconds,
			createdAt: now,
		});

		await this.events.publish({
			action: 'dispatched',
			timestamp: new Date().toISOString(),
			queue,
			jobName: name,
			jobId,
			jobUuid: payload.uuid,
			attempts: 0,
			maxTries: payload.maxTries,
			delaySeconds,
			origin: payload.origin,
			retryOf: payload.retryOf,
			payloadData: data,
		});

		return jobId;
	}

	/**
	 * Publishes one lifecycle transition for a claimed queue job.
	 *
	 * @param action - Queue transition that has already occurred.
	 * @param job - Claimed job associated with the transition.
	 * @param details - Optional timing, delay, and error values.
	 * @returns Published immutable lifecycle event.
	 */
	private async publishJobEvent(
		action: Exclude<queue.QueueLifecycleAction, 'dispatched'>,
		job: queue.QueueJob,
		details: Pick<queue.QueueLifecycleEvent, 'delaySeconds' | 'durationMs' | 'error'> = {},
	): Promise<queue.QueueLifecycleEvent> {
		const event: queue.QueueLifecycleEvent = {
			action,
			timestamp: new Date().toISOString(),
			queue: job.queue,
			jobName: job.payload.job,
			jobId: job.id,
			jobUuid: job.payload.uuid,
			attempts: job.attempts,
			maxTries: job.payload.maxTries,
			origin: job.payload.origin,
			retryOf: job.payload.retryOf,
			payloadData: job.payload.data,
			...details,
		};

		await this.events.publish(event);

		return event;
	}

	/**
	 * Runs one optional QueueableJob hook without changing the queue outcome.
	 *
	 * @param execution - Prepared job execution containing optional hooks.
	 * @param hook - Hook selected by the committed queue transition.
	 * @param event - Lifecycle event already published for the transition.
	 * @param error - Handler error that caused the transition.
	 * @param delaySeconds - Retry delay supplied to onRetry.
	 */
	private async runJobHook(
		execution: QueueJobExecution | null,
		hook: 'onRetry' | 'onFinalFailure',
		event: queue.QueueLifecycleEvent,
		error: unknown,
		delaySeconds?: number,
	): Promise<void> {
		if (!execution) return;

		try {
			if (hook === 'onRetry') {
				await execution.onRetry?.(error, delaySeconds ?? 0);
				return;
			}

			await execution.onFinalFailure?.(error);
		} catch (hookError) {
			this.reportLifecycleFailure({
				source: 'hook',
				hook,
				event,
				error: hookError,
			});
		}
	}

	/**
	 * Reports an isolated lifecycle failure without throwing into queue work.
	 *
	 * @param failure - Listener or job-hook failure to report.
	 */
	private reportLifecycleFailure(failure: queue.QueueLifecycleFailure): void {
		if (this.options.onLifecycleError) {
			try {
				this.options.onLifecycleError(failure);
				return;
			} catch (reportingError) {
				console.error('[queue] Lifecycle error reporter failed.', reportingError);
			}
		}

		const label = failure.hook
			? `job hook ${failure.hook}`
			: 'lifecycle listener';

		console.error(
			`[queue] ${label} failed for ${failure.event.jobName} during ${failure.event.action}.`,
			failure.error,
		);
	}
}

function queueDriverFromEnv(): queue.QueueDriverName {
	const driver = process.env.QUEUE_DRIVER || process.env.QUEUE_CONNECTION || 'database';

	if (driver === 'database') return driver;
	if (driver === 'redis') return driver;

	throw new Error(`Unsupported queue driver "${driver}".`);
}

function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Resolves the default retry strategy from queue environment configuration.
 *
 * @returns Supported retry strategy, defaulting to exponential.
 */
function retryBackoffStrategyFromEnv(): queue.QueueRetryBackoffStrategy {
	return process.env.QUEUE_RETRY_BACKOFF === 'linear'
		? 'linear'
		: 'exponential';
}

/**
 * Reads a boolean queue environment value with a deterministic fallback.
 *
 * @param name - Environment variable name.
 * @param fallback - Value used when the variable is absent or invalid.
 * @returns Parsed boolean configuration.
 */
function booleanFromEnv(name: string, fallback: boolean): boolean {
	const value = process.env[name]?.trim().toLowerCase();

	if (value === 'true' || value === '1') return true;
	if (value === 'false' || value === '0') return false;

	return fallback;
}

/**
 * Normalizes one positive integer queue option.
 *
 * @param value - Requested option value.
 * @param fallback - Value used when the request is absent or invalid.
 * @returns Positive integer.
 */
function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.max(1, Math.trunc(value))
		: fallback;
}

/**
 * Resolves the durable queue job name for any supported dispatch input.
 */
function resolveDispatchedJobName(
	job: string | QueueableJob,
	serializedName?: string,
): string {
	if (serializedName) return serializedName;
	if (typeof job === 'string') return job;

	return queueableJobName(job.constructor as queue.QueueableJobClass);
}
