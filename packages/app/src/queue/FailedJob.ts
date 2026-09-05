import { ActiveRecord, type FieldBuilder } from '../db';
import type * as queue from './contracts';

/**
 * Queue record for jobs that exhausted their configured attempts.
 */
export class FailedJob extends ActiveRecord {
	static override table = 'jobs_failed';
	static override primaryKey = 'id';

	/**
	 * Defines the database schema for jobs that have exhausted their retries.
	 *
	 * @param field - Field builder used by ActiveRecord schema installation.
	 * @returns Failed queue job field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.bigIncrements(),

			uuid: field.string({
				required: true,
				unique: true,
				length: 255,
			}),

			connection: field.text({
				required: true,
			}),

			queue: field.text({
				required: true,
			}),

			payload: field.jsonLongText<queue.JobEnvelope>({
				required: true,
			}),

			exception: field.longText({
				required: true,
			}),

			failedAt: field.timestamp({
				column: 'failed_at',
				required: true,
				auto: 'create',
			}),
		};
	}

	declare id: number | null;
	declare uuid: string | null;
	declare connection: string | null;
	declare queue: string | null;
	declare payload: queue.JobEnvelope<Record<string, unknown>> | null;
	declare exception: string | null;
	declare failedAt: Date | null;
}
