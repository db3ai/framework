import { ActiveRecord } from '../db/ActiveRecord';

/** Retains each execution boundary, including attempts interrupted before a handler could fail itself. */
export class JobRunAttempt extends ActiveRecord.define({
	table: 'job_run_attempts',
	fields: field => ({
		id: field.ulid(),
		runId: field.string({ column: 'run_id', required: true, length: 26, index: true }),
		tenantId: field.string({ column: 'tenant_id', required: true, length: 100, index: true }),
		attempt: field.integer({ required: true }),
		deliveryId: field.string({ column: 'delivery_id', required: true, length: 100 }),
		status: field.string({ required: true, length: 30 }),
		error: field.text(),
		startedAt: field.timestamp({ column: 'started_at', required: true }),
		completedAt: field.timestamp({ column: 'completed_at' }),
	}),
}) {}
