import { ulid } from '@db3.ai/pure/ulid';
import { ActiveRecord, type FieldBuilder } from '../db';
import { SCHEDULED_OCCURRENCE_STATUSES, SCHEDULED_TASK_KINDS } from './constants';
import type * as scheduler from './contracts';

const NAME_SCHEDULED_FOR_UNIQUE = 'scheduled_occurrences_name_scheduled_for_unique';
const STATUS_SCHEDULED_FOR_INDEX = 'scheduled_occurrences_status_scheduled_for_index';

/**
 * Values required to atomically claim one due scheduled occurrence.
 */
interface ScheduledOccurrenceClaim {
	/** Stable registered schedule name. */
	name: string;
	/** Scheduled task kind. */
	kind: scheduler.ScheduledTaskKind;
	/** Canonical UTC minute represented by the occurrence. */
	scheduledFor: Date;
	/** Queue job name when known before a factory is invoked. */
	jobName?: string;
}

/**
 * Durable claim, execution state, and queue correlation for one scheduled task.
 */
export class ScheduledOccurrence extends ActiveRecord {
	static override table = 'scheduled_occurrences';
	static override primaryKey = 'id';
	static override labelFields = ['name', 'status'];
	static override comment = 'Durable scheduler claims and lifecycle state for registered task occurrences.';

	/**
	 * Defines scheduler claim, queue correlation, lifecycle, and timing fields.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Scheduled occurrence field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable scheduled occurrence ULID.',
			}),

			name: field.string({
				required: true,
				length: 255,
				maxLength: 255,
				indexes: [{
					name: NAME_SCHEDULED_FOR_UNIQUE,
					columns: ['name', 'scheduled_for'],
					unique: true,
				}],
				comment: 'Stable registered schedule name used for deduplication.',
			}),

			kind: field.choice({
				required: true,
				choices: SCHEDULED_TASK_KINDS,
				length: 20,
				maxLength: 20,
				comment: 'Whether this occurrence dispatches a job or runs an inline call.',
			}),

			jobName: field.string({
				column: 'job_name',
				required: false,
				length: 255,
				maxLength: 255,
				index: true,
				comment: 'Durable queue job name for job occurrences.',
			}),

			scheduledFor: field.timestamp({
				column: 'scheduled_for',
				required: true,
				precision: 0,
				index: true,
				comment: 'Canonical UTC minute represented by this occurrence.',
			}),

			status: field.choice({
				required: true,
				choices: SCHEDULED_OCCURRENCE_STATUSES,
				default: 'claimed',
				length: 20,
				maxLength: 20,
				indexes: [{
					name: STATUS_SCHEDULED_FOR_INDEX,
					columns: ['status', 'scheduled_for'],
				}],
				comment: 'Current scheduler or queue lifecycle state.',
			}),

			queueJobId: field.string({
				column: 'queue_job_id',
				required: false,
				length: 255,
				maxLength: 255,
				index: true,
				comment: 'Driver-owned queue job id after dispatch.',
			}),

			queueJobUuid: field.charUuid({
				column: 'queue_job_uuid',
				required: false,
				index: true,
				comment: 'Stable queue UUID retained across job attempts.',
			}),

			attempts: field.integer({
				required: true,
				unsigned: true,
				min: 0,
				default: 0,
				comment: 'Number of queue processing attempts observed.',
			}),

			maxTries: field.integer({
				column: 'max_tries',
				required: false,
				unsigned: true,
				min: 1,
				comment: 'Maximum queue attempts configured for this job.',
			}),

			lastError: field.longText({
				column: 'last_error',
				required: false,
				comment: 'Most recent dispatch, callback, retry, or terminal failure.',
			}),

			nextAttemptAt: field.timestamp({
				column: 'next_attempt_at',
				required: false,
				precision: 0,
				comment: 'Expected availability time after a retry or deferral.',
			}),

			claimedAt: field.timestamp({
				column: 'claimed_at',
				required: true,
				precision: 3,
				comment: 'Time at which a scheduler process won this occurrence claim.',
			}),

			dispatchedAt: field.timestamp({
				column: 'dispatched_at',
				required: false,
				precision: 3,
				comment: 'Time at which the queue accepted the scheduled job.',
			}),

			startedAt: field.timestamp({
				column: 'started_at',
				required: false,
				precision: 3,
				comment: 'First worker claim or inline callback start time.',
			}),

			finishedAt: field.timestamp({
				column: 'finished_at',
				required: false,
				precision: 3,
				comment: 'Terminal scheduler or queue completion time.',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				required: true,
				precision: 3,
				auto: 'update',
				comment: 'Most recent lifecycle state change.',
			}),
		};
	}

	/**
	 * Atomically claims one scheduled minute using the model's unique index.
	 *
	 * @param claim - Due schedule identity and task metadata.
	 * @returns Newly claimed occurrence, or null when another process won.
	 */
	static async claim(claim: ScheduledOccurrenceClaim): Promise<ScheduledOccurrence | null> {
		const claimedAt = new Date();
		const occurrence = this.create({
			id: ulid(claimedAt),
			name: claim.name,
			kind: claim.kind,
			jobName: claim.jobName,
			scheduledFor: claim.scheduledFor,
			status: 'claimed',
			attempts: 0,
			claimedAt,
			updatedAt: claimedAt,
		});

		try {
			await occurrence.save();
			return occurrence;
		} catch (error) {
			if (!isUniqueConstraintError(error)) throw error;

			const existing = await this
				.where({
					name: claim.name,
					scheduledFor: claim.scheduledFor,
				})
				.first();

			if (existing) return null;

			throw error;
		}
	}

	declare id: string | null;
	declare name: string | null;
	declare kind: scheduler.ScheduledTaskKind | null;
	declare jobName: string | null;
	declare scheduledFor: Date | null;
	declare status: scheduler.ScheduledOccurrenceStatus | null;
	declare queueJobId: string | null;
	declare queueJobUuid: string | null;
	declare attempts: number | null;
	declare maxTries: number | null;
	declare lastError: string | null;
	declare nextAttemptAt: Date | null;
	declare claimedAt: Date | null;
	declare dispatchedAt: Date | null;
	declare startedAt: Date | null;
	declare finishedAt: Date | null;
	declare updatedAt: Date | null;
}

/**
 * Returns whether a database error represents a unique-constraint conflict.
 *
 * @param error - Unknown database failure.
 * @returns True for MariaDB, PostgreSQL, or SQLite unique conflicts.
 */
function isUniqueConstraintError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;

	const code = String((error as { code?: unknown }).code ?? '');

	return code === 'ER_DUP_ENTRY'
		|| code === '23505'
		|| code === 'SQLITE_CONSTRAINT'
		|| code === 'SQLITE_CONSTRAINT_UNIQUE';
}
