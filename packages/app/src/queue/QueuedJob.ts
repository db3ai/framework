import { ActiveRecord, type FieldBuilder } from '../db';
import type * as queue from './contracts';

/**
 * Active queue record persisted by the database queue driver.
 */
export class QueuedJob extends ActiveRecord {
	static override table = 'jobs';
	static override primaryKey = 'id';

	/**
	 * Defines the database schema for active queued jobs.
	 *
	 * @param field - Field builder used by ActiveRecord schema installation.
	 * @returns Queue job field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.bigIncrements(),

			queue: field.string({
				required: true,
				length: 255,
				index: true,
			}),

			payload: field.jsonLongText<queue.JobEnvelope>({
				required: true,
			}),

			attempts: field.integer({
				required: true,
				unsigned: true,
				min: 0,
				default: 0,
			}),

			reservedAt: field.integer({
				column: 'reserved_at',
				unsigned: true,
				min: 0,
				index: true,
			}),

			availableAt: field.integer({
				column: 'available_at',
				required: true,
				unsigned: true,
				min: 0,
				index: true,
			}),

			createdAt: field.integer({
				column: 'created_at',
				required: true,
				unsigned: true,
				min: 0,
			}),
		};
	}

	declare id: number | null;
	declare queue: string | null;
	declare payload: queue.JobEnvelope<Record<string, unknown>> | null;
	declare attempts: number | null;
	declare reservedAt: number | null;
	declare availableAt: number | null;
	declare createdAt: number | null;
}
