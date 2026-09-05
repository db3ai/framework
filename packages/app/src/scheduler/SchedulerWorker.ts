import type * as scheduler from './contracts';
import { Scheduler } from './Scheduler';

const DEFAULT_SLOW_TICK_WARNING_MS = 50_000;

/**
 * Long-running minute-aligned process adapter around Scheduler.runDue().
 */
export class SchedulerWorker {
	#running = false;
	#abortController: AbortController | null = null;
	readonly #now: () => Date;
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
		this.#now = options.now ?? (() => new Date());
		this.#sleep = options.sleep ?? schedulerSleep;
		this.#logger = options.logger ?? consoleSchedulerLogger();
		this.#slowTickWarningMs = options.slowTickWarningMs
			?? DEFAULT_SLOW_TICK_WARNING_MS;
	}

	/**
	 * Runs immediately, then evaluates at each subsequent wall-clock minute.
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
			while (this.#running) {
				await this.runTick();

				if (!this.#running) break;

				await this.#sleep(
					millisecondsUntilNextMinute(this.#now()),
					this.#abortController.signal,
				);
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
	 * Evaluates one scheduler minute and reports failures without ending work.
	 */
	private async runTick(): Promise<void> {
		const startedAt = performance.now();

		try {
			const result = await this.schedulerService.runDue(this.#now());

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
			this.#logger.error('[scheduler] Tick failed; the worker will continue.', error);
		}

		const durationMs = performance.now() - startedAt;

		if (durationMs >= this.#slowTickWarningMs) {
			this.#logger.warn(
				`[scheduler] Tick took ${Math.round(durationMs)}ms; inline calls should remain short.`,
			);
		}
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
		const timeout = setTimeout(resolve, delayMs);

		signal.addEventListener('abort', () => {
			clearTimeout(timeout);
			resolve();
		}, {
			once: true,
		});
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
