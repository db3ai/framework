import { unknownErrorMessage } from '@db3.ai/pure';

import type { Queue } from './Queue';
import type * as queue from './contracts';

export type { QueueLogger, QueueWorkerLifecycle, QueueWorkerOptions } from './contracts';

const DEFAULT_WORKER_INTERVAL_MS = 1000;
const MIN_WORKER_INTERVAL_MS = 100;
const DEFAULT_MAX_JOBS_PER_TICK = 5;
const MIN_MAX_JOBS_PER_TICK = 1;

/**
 * Polls one queue and asks Queue to process available jobs.
 *
 * The worker intentionally owns only timer and lifecycle behavior. It delegates claims,
 * handler execution, retries, and failure recording back to Queue.
 */
export class QueueWorker implements queue.QueueWorkerLifecycle {
	#activeTick: Promise<void> | null = null;
	private timer: NodeJS.Timeout | null = null;
	private readonly intervalMs: number;
	private readonly maxJobsPerTick: number;

	constructor(
		private readonly queueManager: Queue,
		private readonly queue = 'default',
		intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || DEFAULT_WORKER_INTERVAL_MS),
		maxJobsPerTick = Number(process.env.QUEUE_WORKER_MAX_JOBS_PER_TICK || DEFAULT_MAX_JOBS_PER_TICK),
		private readonly logger?: queue.QueueLogger,
		private readonly verbose = false,
	) {
		this.intervalMs = normalizeWorkerIntervalMs(intervalMs);
		this.maxJobsPerTick = normalizeMaxJobsPerTick(maxJobsPerTick);
	}

	/**
	 * Starts the worker with an immediate tick followed by interval-based polling.
	 */
	start(): void {
		if (this.timer) return;

		this.logger?.info(this.verbose
			? `[queue] Worker started for "${this.queue}" (interval ${this.intervalMs}ms, max ${this.maxJobsPerTick} jobs/tick).`
			: `[queue] Worker started for "${this.queue}".`);
		this.startTick();
		this.timer = setInterval(() => {
			this.startTick();
		}, this.intervalMs);
	}

	/**
	 * Stops future polling ticks. Any already-running tick is allowed to finish.
	 */
	stop(): void {
		if (!this.timer) return;

		clearInterval(this.timer);
		this.timer = null;
		this.logger?.info(`[queue] Worker stopped for "${this.queue}".`);
	}

	/**
	 * Stops future polling and waits for the active queue tick to finish.
	 */
	async stopAndDrain(): Promise<void> {
		this.stop();

		if (this.#activeTick) {
			await this.#activeTick;
		}
	}

	/**
	 * Starts one tick when the previous tick is no longer running.
	 */
	private startTick(): void {
		if (this.#activeTick) return;

		const tick = this.tick();

		this.#activeTick = tick;
		void tick.finally(() => {
			if (this.#activeTick === tick) {
				this.#activeTick = null;
			}
		});
	}

	/**
	 * Claims and processes the bounded set of jobs assigned to one polling tick.
	 */
	private async tick(): Promise<void> {
		let processedThisTick = 0;

		try {
			for (let processed = 0; processed < this.maxJobsPerTick; processed += 1) {
				const result = await this.queueManager.workNextJob(this.queue, {
					onClaimed: job => this.logClaimed(job),
				});

				if (!result) {
					this.logIdle(processedThisTick);
					break;
				}

				processedThisTick += 1;
				this.logResult(result);
			}

			if (processedThisTick >= this.maxJobsPerTick) {
				this.logTickLimit(processedThisTick);
			}
		} catch (error) {
			this.logger?.error?.(
				`[queue] Worker tick failed for "${this.queue}". ${unknownErrorMessage(error)}`,
			);
		}
	}

	/**
	 * Logs that the worker reached an idle poll.
	 *
	 * @param processedThisTick - Number of jobs processed before the queue became idle.
	 */
	private logIdle(processedThisTick: number): void {
		if (!this.verbose) return;

		const drained = processedThisTick > 0
			? ` after processing ${processedThisTick} ${plural('job', processedThisTick)}`
			: '';

		this.logger?.info(
			`[queue] Idle on "${this.queue}"${drained}; next check in ${this.intervalMs}ms.`,
		);
	}

	/**
	 * Logs that this tick hit the configured maximum jobs per tick.
	 *
	 * @param processedThisTick - Number of jobs processed during this tick.
	 */
	private logTickLimit(processedThisTick: number): void {
		if (!this.verbose) return;

		this.logger?.info(
			`[queue] Processed ${processedThisTick} ${plural('job', processedThisTick)} this tick; next check in ${this.intervalMs}ms.`,
		);
	}

	/**
	 * Logs the final outcome for a processed queue job.
	 *
	 * @param result - Queue processing result returned by the queue manager.
	 */
	private logResult(result: queue.QueueProcessResult): void {
		const job = result.job;
		const label = `${job.payload.job}#${job.id}`;

		if (result.status === 'succeeded') {
			this.logger?.info(
				`[queue] Processed ${label} on "${job.queue}".${this.verboseNextJobMessage(job)}`,
			);
			return;
		}

		if (result.status === 'released') {
			this.logger?.warn?.(
				`[queue] Released ${label} after attempt ${job.attempts}/${job.payload.maxTries}; retrying in ${result.delaySeconds ?? 0}s. ${unknownErrorMessage(result.error)}`,
			);
			return;
		}

		if (result.status === 'deferred') {
			this.logger?.warn?.(
				`[queue] Deferred ${label}; retrying in ${result.delaySeconds ?? 0}s. ${unknownErrorMessage(result.error)}`,
			);
			return;
		}

		if (result.status === 'lease_lost') {
			this.logger?.warn?.(
				`[queue] Stopped fenced ${label} attempt ${job.attempts}; lease ownership could not be confirmed. ${unknownErrorMessage(result.error)}`,
			);
			return;
		}

		this.logger?.error?.(
			`[queue] Failed ${label} after ${job.attempts}/${job.payload.maxTries} attempts. ${unknownErrorMessage(result.error)}`,
		);
	}

	/**
	 * Logs that a queue job has been claimed and is about to run.
	 *
	 * @param job - Claimed queue job.
	 */
	private logClaimed(job: queue.QueueJob): void {
		const label = `${job.payload.job}#${job.id}`;

		this.logger?.info(
			`[queue] Claimed ${label} on "${job.queue}" attempt ${job.attempts}/${job.payload.maxTries}.`,
		);

		if (!this.verbose) return;

		this.logger?.info(
			`[queue] Running ${label}; payload keys: ${payloadKeys(job)}; next on success: ${nextJobLabel(job) ?? 'none'}.`,
		);
	}

	/**
	 * Returns a verbose suffix describing the next chained job.
	 *
	 * @param job - Completed queue job.
	 * @returns Empty string or a sentence fragment for the next queued job.
	 */
	private verboseNextJobMessage(job: queue.QueueJob): string {
		if (!this.verbose) return '';

		const next = nextJobLabel(job);

		return next ? ` Queued next ${next}.` : ' No chained job remains.';
	}
}

export { QueueWorker as DatabaseQueueWorker };

/**
 * Formats a singular or plural word for a count.
 *
 * @param word - Singular word to pluralize.
 * @param count - Number of items.
 * @returns Word with a simple plural suffix when needed.
 */
function plural(word: string, count: number): string {
	return count === 1 ? word : `${word}s`;
}

/**
 * Normalizes worker polling intervals so bad env or CLI values cannot create a hot loop.
 *
 * @param value - Requested interval in milliseconds.
 * @returns A safe polling interval in milliseconds.
 */
function normalizeWorkerIntervalMs(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_WORKER_INTERVAL_MS;

	return Math.max(MIN_WORKER_INTERVAL_MS, Math.floor(value));
}

/**
 * Normalizes the per-tick job limit so workers always make bounded forward progress.
 *
 * @param value - Requested number of jobs to process per tick.
 * @returns A safe integer job limit.
 */
function normalizeMaxJobsPerTick(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_JOBS_PER_TICK;

	return Math.max(MIN_MAX_JOBS_PER_TICK, Math.floor(value));
}

/**
 * Returns a readable list of payload keys for terminal output.
 *
 * @param job - Queue job whose payload data should be described.
 * @returns Comma-separated payload keys or none.
 */
function payloadKeys(job: queue.QueueJob): string {
	const keys = Object.keys(job.payload.data ?? {});

	return keys.length > 0 ? keys.join(', ') : 'none';
}

/**
 * Returns the next chained job name from a queue payload.
 *
 * @param job - Queue job whose chain should be inspected.
 * @returns Next chained job label or null.
 */
function nextJobLabel(job: queue.QueueJob): string | null {
	const [next] = job.payload.chained ?? [];

	return next ? serializedJobLabel(next) : null;
}

/**
 * Builds a terminal label for a serialized queued job.
 *
 * @param job - Serialized queued job.
 * @returns Readable job label.
 */
function serializedJobLabel(job: queue.SerializedQueuedJob): string {
	return job.displayName || job.job;
}
