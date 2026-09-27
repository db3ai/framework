import type { SchedulerLogger, SchedulerRunResult } from './Scheduler';
import type { SchedulerCheckpoint } from './SchedulerCheckpoint';

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
	/** Durable coverage across process restarts; without it, coverage starts in the current process. */
	checkpoint?: SchedulerCheckpoint;
	/** Records a successful evaluation and its actual minute; hook failures retry that minute. */
	onTick?: (result: SchedulerRunResult) => Promise<void>;
	/** Clock used to align and evaluate scheduler ticks. */
	now?: () => Date;
	/** Abort-aware sleeper used between minute boundaries. */
	sleep?: SchedulerSleep;
	/** Scheduler progress and error logger. */
	logger?: SchedulerLogger;
	/** Duration that triggers a slow-tick warning. */
	slowTickWarningMs?: number;
}
