import type { SchedulerLogger } from './Scheduler';

/**
 * Abort-aware sleep function used by the long-running scheduler worker.
 */
export type SchedulerSleep = (
	delayMs: number,
	signal: AbortSignal,
) => Promise<void>;

/**
 * Runtime dependencies and logging overrides for SchedulerWorker.
 */
export interface SchedulerWorkerOptions {
	/** Clock used to align and evaluate scheduler ticks. */
	now?: () => Date;
	/** Abort-aware sleeper used between minute boundaries. */
	sleep?: SchedulerSleep;
	/** Scheduler progress and error logger. */
	logger?: SchedulerLogger;
	/** Duration that triggers a slow-tick warning. */
	slowTickWarningMs?: number;
}
