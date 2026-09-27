import type { ScheduledJob } from '../ScheduledJob';
import type { ScheduledCall } from '../ScheduledCall';
import type { ScheduledJobSource, ScheduledCallHandler, ScheduledTaskDefinition } from './Scheduler';

/** Fluent declaration surface shared by the host scheduler and app-owned schedule.ts files. */
export interface Schedule {
	/** Declares queued work; workers execute the expensive operation. */
	job(source: ScheduledJobSource): ScheduledJob;
	/** Declares a short inline operation executed by the scheduler. */
	call(handler: ScheduledCallHandler): ScheduledCall;
}

/** Ownership handle for one group's registrations. Closing removes only that group. */
export interface ScheduleRegistration {
	/** Browser-safe definitions, including the owning app identifier. */
	definitions: ScheduledTaskDefinition[];
	/** Idempotently removes the group's runtime definitions. Durable history remains. */
	close(): void;
}

/** Wraps one complete occurrence, including claiming and dispatch, in the owner's lifecycle gate. */
export type ScheduleRunner = (operation: () => Promise<void>) => Promise<void>;
