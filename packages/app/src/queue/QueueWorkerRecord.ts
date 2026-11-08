import { ActiveRecord, type FieldBuilder } from '../db';
import type * as queue from './contracts';

/**
 * Latest presence of one database-queue worker (a pool and all of its slots), upserted on every heartbeat so hosting tools
 * can show which queues each worker consumes, whether it is idle or busy, and what it has done.
 * Rows are written only when an app installs this model; stale rows are pruned by the driver.
 */
export class QueueWorkerRecord extends ActiveRecord {
	static override table = 'jobs_workers';
	static override primaryKey = 'id';

	/**
	 * Defines the database schema for worker presence.
	 *
	 * @param field - Field builder used by ActiveRecord schema installation.
	 * @returns Worker presence field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({ comment: 'Worker slot identity from QueueWorkerSnapshot.' }),
			name: field.string({ required: true, length: 255, maxLength: 255, comment: 'Worker name, such as the --name option or QUEUE_WORKER_NAME.' }),
			hostname: field.string({ required: true, length: 255, maxLength: 255, index: true, comment: 'Host the worker runs on; the pod name under Kubernetes.' }),
			pid: field.integer({ required: true, unsigned: true, min: 0 }),
			selection: field.jsonLongText<queue.QueueSelection>({ required: true, comment: 'Queues the worker consumes and excludes.' }),
			status: field.string({ required: true, length: 16, maxLength: 16, comment: 'idle, busy, stopping or stopped.' }),
			currentQueue: field.string({ column: 'current_queue', length: 255, maxLength: 255 }),
			currentJobId: field.string({ column: 'current_job_id', length: 255, maxLength: 255 }),
			busy: field.integer({ unsigned: true, min: 0, comment: 'Slots running a job at the latest report.' }),
			slots: field.integer({ unsigned: true, min: 0, comment: 'Execution slots in this worker.' }),
			processed: field.integer({ required: true, unsigned: true, min: 0, default: 0, comment: 'Jobs that succeeded since the worker started.' }),
			failed: field.integer({ required: true, unsigned: true, min: 0, default: 0, comment: 'Jobs that failed for good since the worker started.' }),
			startedAt: field.integer({ column: 'started_at', required: true, unsigned: true, min: 0, comment: 'Unix seconds.' }),
			heartbeatAt: field.integer({ column: 'heartbeat_at', required: true, unsigned: true, min: 0, index: true, comment: 'Unix seconds of the latest report.' }),
			lastJobAt: field.integer({ column: 'last_job_at', unsigned: true, min: 0, comment: 'Unix seconds when the latest job finished.' }),
		};
	}

	declare id: string | null;
	declare name: string | null;
	declare hostname: string | null;
	declare pid: number | null;
	declare selection: queue.QueueSelection | null;
	declare status: queue.QueueWorkerSnapshot['status'] | null;
	declare currentQueue: string | null;
	declare currentJobId: string | null;
	declare busy: number | null;
	declare slots: number | null;
	declare processed: number | null;
	declare failed: number | null;
	declare startedAt: number | null;
	declare heartbeatAt: number | null;
	declare lastJobAt: number | null;
}
