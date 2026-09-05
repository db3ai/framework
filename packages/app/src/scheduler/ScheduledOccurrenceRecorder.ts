import { ActiveRecord, type Database } from '../db';
import type { QueueLifecycleEvent } from '../queue';
import { SCHEDULED_OCCURRENCE_ORIGIN } from './constants';
import { ScheduledOccurrence } from './ScheduledOccurrence';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed']);

/**
 * Persists queue lifecycle events that originated from scheduled occurrences.
 */
export class ScheduledOccurrenceRecorder {
	/**
	 * Creates a recorder bound to one application database.
	 *
	 * @param database - Database containing scheduled occurrence records.
	 */
	constructor(
		private readonly database: Database,
	) {}

	/**
	 * Applies one queue event when it references a scheduled occurrence.
	 *
	 * @param event - Queue lifecycle event emitted by the worker or dispatcher.
	 */
	async record(event: QueueLifecycleEvent): Promise<void> {
		if (event.origin?.type !== SCHEDULED_OCCURRENCE_ORIGIN) return;

		await ActiveRecord.withDb(this.database.knex, async () => {
			const occurrence = await ScheduledOccurrence.findByPk(event.origin?.id);

			if (!occurrence) {
				throw new Error(`Scheduled occurrence "${event.origin?.id}" was not found.`);
			}

			if (occurrence.status && TERMINAL_STATUSES.has(occurrence.status)) return;

			this.applyEvent(occurrence, event);
			await occurrence.save();
		});
	}

	/**
	 * Maps one queue lifecycle event onto its persisted occurrence.
	 *
	 * @param occurrence - Scheduled occurrence being updated.
	 * @param event - Queue lifecycle event to apply.
	 */
	private applyEvent(
		occurrence: ScheduledOccurrence,
		event: QueueLifecycleEvent,
	): void {
		if (event.action === 'lease_lost') return;

		const timestamp = new Date(event.timestamp);

		occurrence.jobName = event.jobName;
		occurrence.queueJobId = String(event.jobId);
		occurrence.queueJobUuid = event.jobUuid;
		occurrence.attempts = event.attempts;
		occurrence.maxTries = event.maxTries;

		if (event.error !== undefined) {
			occurrence.lastError = errorDetails(event.error);
		}

		switch (event.action) {
			case 'dispatched':
				occurrence.status = 'queued';
				occurrence.dispatchedAt ??= timestamp;
				break;

			case 'claimed':
				occurrence.status = 'running';
				occurrence.startedAt ??= timestamp;
				occurrence.nextAttemptAt = null;
				break;

			case 'released':
				occurrence.status = 'retrying';
				occurrence.nextAttemptAt = delayedDate(timestamp, event.delaySeconds);
				break;

			case 'deferred':
				occurrence.status = 'deferred';
				occurrence.nextAttemptAt = delayedDate(timestamp, event.delaySeconds);
				break;

			case 'succeeded':
				occurrence.status = 'succeeded';
				occurrence.nextAttemptAt = null;
				occurrence.finishedAt = timestamp;
				break;

			case 'failed':
				occurrence.status = 'failed';
				occurrence.nextAttemptAt = null;
				occurrence.finishedAt = timestamp;
				break;
		}
	}
}

/**
 * Calculates the expected next-attempt time for a delayed queue event.
 *
 * @param timestamp - Time at which the queue transition occurred.
 * @param delaySeconds - Delay before the next attempt.
 * @returns Expected next attempt time.
 */
function delayedDate(timestamp: Date, delaySeconds = 0): Date {
	return new Date(timestamp.getTime() + Math.max(0, delaySeconds) * 1000);
}

/**
 * Formats an unknown error for durable scheduler diagnostics.
 *
 * @param error - Unknown thrown value.
 * @returns Stack or human-readable error text.
 */
export function errorDetails(error: unknown): string {
	if (error instanceof Error) return error.stack ?? error.message;

	return String(error);
}
