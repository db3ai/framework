import type * as scheduler from './contracts';
import { Scheduler } from './Scheduler';
import { utcMinute } from './scheduleTime';

const DEFAULT_SLOW_TICK_WARNING_MS = 50_000;
const MINUTE_MS = 60_000;
const MAX_MINUTES_PER_BATCH = 60;
const FAILED_TICK_RETRY_MS = 1_000;

/**
 * Long-running minute-aligned process adapter around Scheduler.runDue().
 */
export class SchedulerWorker {
	#running = false;
	#abortController: AbortController | null = null;
	readonly #now: () => Date;
	#nextMinute: number | null = null;
	readonly #onTick?: scheduler.SchedulerWorkerOptions['onTick'];
	readonly #checkpoint?: scheduler.SchedulerCheckpoint;
	readonly #sleep: scheduler.SchedulerSleep;
	readonly #logger: scheduler.SchedulerLogger;
	readonly #slowTickWarningMs: number;

	/**
	 * Creates a scheduler worker with injectable timing dependencies.
	 *
	 * @param schedulerService - Scheduler core evaluated on every tick.
	 * @param options - Clock, sleeper, logger, and warning overrides.
	 */
	constructor(
		private readonly schedulerService: Scheduler,
		options: scheduler.SchedulerWorkerOptions = {},
	) {
		this.#onTick = options.onTick;
		this.#checkpoint = options.checkpoint;
		this.#now = options.now ?? (() => new Date());
		this.#sleep = options.sleep ?? schedulerSleep;
		this.#logger = options.logger ?? consoleSchedulerLogger();
		this.#slowTickWarningMs = options.slowTickWarningMs
			?? DEFAULT_SLOW_TICK_WARNING_MS;
	}

	/**
	 * Evaluates every uncovered minute in order, including time spent dispatching
	 * earlier batches. Catch-up yields after sixty minutes without discarding work.
	 * A durable checkpoint resumes coverage across replacement processes.
	 *
	 * @throws Error when the same worker instance is started twice.
	 */
	async start(): Promise<void> {
		if (this.#running) {
			throw new Error('SchedulerWorker is already running.');
		}

		this.#running = true;
		this.#abortController = new AbortController();

		try {
			if (this.#nextMinute === null) {
				const firstMinute = utcMinute(this.#now());
				const previous = await this.#checkpoint?.load(firstMinute);
				this.#nextMinute = previous ? utcMinute(previous).getTime() + MINUTE_MS : firstMinute.getTime();
			}
			let batchSize = 0;
			while (this.#running) {
				const now = this.#now();
				const currentMinute = utcMinute(now).getTime();
				if (this.#nextMinute <= currentMinute) {
					const completed = await this.#runTick(new Date(this.#nextMinute));
					if (completed) this.#nextMinute += MINUTE_MS;
					if (!this.#running) break;
					if (!completed || ++batchSize >= MAX_MINUTES_PER_BATCH) {
						await this.#sleep(completed ? 1 : FAILED_TICK_RETRY_MS, this.#abortController.signal);
						batchSize = 0;
					}
					continue;
				}
				batchSize = 0;
				// An early timer or backward clock step must not skip or repeat a minute.
				await this.#sleep(Math.min(MINUTE_MS, Math.max(1, this.#nextMinute - now.getTime())), this.#abortController.signal);
			}
		} finally {
			this.#running = false;
			this.#abortController = null;
		}
	}

	/**
	 * Requests graceful shutdown and interrupts the current minute wait.
	 */
	stop(): void {
		this.#running = false;
		this.#abortController?.abort();
	}

	/**
	 * Evaluates one fixed minute, preserving progress only after the whole batch.
	 * Recorded event failures remain visible and do not prevent later minutes;
	 * incomplete evaluations and checkpoint failures retry this same minute.
	 *
	 * @param evaluatedFor - Original scheduled minute, independent of dispatch duration.
	 * @returns Whether the complete minute was evaluated and its checkpoint saved.
	 */
	async #runTick(evaluatedFor: Date): Promise<boolean> {
		const startedAt = performance.now();
		let completed = false;

		try {
			const result = await this.schedulerService.runDue(evaluatedFor);
			if (result.failures.length === 0) await this.#onTick?.(result);
			await this.#checkpoint?.save(evaluatedFor);
			completed = true;

			if (result.due > 0 || result.failures.length > 0) {
				this.#logger.info(
					`[scheduler] ${result.evaluatedFor.toISOString()} due=${result.due} claimed=${result.claimed} dispatched=${result.dispatched} completed=${result.completed} skipped=${result.skipped} failed=${result.failures.length}.`,
				);
			}

			for (const failure of result.failures) {
				this.#logger.error(
					`[scheduler] Scheduled event "${failure.name}" failed: ${failure.error}`,
				);
			}
		} catch (error) {
			this.#logger.error(`[scheduler] Evaluation for ${evaluatedFor.toISOString()} did not finish; retrying the same minute.`, error);
		}

		const durationMs = performance.now() - startedAt;

		if (durationMs >= this.#slowTickWarningMs) {
			this.#logger.warn(
				`[scheduler] Tick took ${Math.round(durationMs)}ms; inline calls should remain short.`,
			);
		}
		return completed;
	}
}

/**
 * Calculates the delay from one instant to the next UTC minute boundary.
 *
 * @param now - Current clock time.
 * @returns Delay in milliseconds, always between one and sixty seconds.
 */
export function millisecondsUntilNextMinute(now: Date): number {
	const remainder = now.getTime() % 60_000;

	return remainder === 0 ? 60_000 : 60_000 - remainder;
}

/**
 * Sleeps until a timeout expires or the worker aborts its wait.
 *
 * @param delayMs - Milliseconds to wait.
 * @param signal - Worker shutdown signal.
 */
async function schedulerSleep(
	delayMs: number,
	signal: AbortSignal,
): Promise<void> {
	await new Promise<void>(resolve => {
		/** Clears the timer and its abort subscription on either completion path. */
		const finish = (): void => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', finish);
			resolve();
		};
		const timeout = setTimeout(finish, delayMs);
		signal.addEventListener('abort', finish, { once: true });
		if (signal.aborted) finish();
	});
}

/**
 * Creates the default console-backed scheduler logger.
 *
 * @returns Scheduler logger writing to standard console methods.
 */
function consoleSchedulerLogger(): scheduler.SchedulerLogger {
	return {
		info: message => console.log(message),
		warn: message => console.warn(message),
		error: (message, error) => console.error(message, error ?? ''),
	};
}
