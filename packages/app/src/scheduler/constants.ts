import type * as scheduler from './contracts';

/**
 * Stable origin type persisted on queue jobs dispatched by the scheduler.
 */
export const SCHEDULED_OCCURRENCE_ORIGIN = 'scheduled-occurrence';

/**
 * Supported scheduled occurrence status values.
 */
export const SCHEDULED_OCCURRENCE_STATUSES: scheduler.ScheduledOccurrenceStatus[] = [
	'claimed',
	'queued',
	'running',
	'retrying',
	'deferred',
	'succeeded',
	'failed',
];

/**
 * Supported scheduled task kinds.
 */
export const SCHEDULED_TASK_KINDS: scheduler.ScheduledTaskKind[] = [
	'job',
	'call',
];
