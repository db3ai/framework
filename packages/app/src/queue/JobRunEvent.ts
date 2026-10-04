import { ActiveRecord } from '../db/ActiveRecord';

/** Append-only diagnostic evidence for a run; applications control access and retention. */
export class JobRunEvent extends ActiveRecord.define({
	table: 'job_run_events',
	fields: field => ({
		id: field.ulid(),
		runId: field.string({ column: 'run_id', required: true, length: 26, index: true }),
		tenantId: field.string({ column: 'tenant_id', required: true, length: 100, index: true }),
		attempt: field.integer({ required: true, default: 0 }),
		level: field.choice({ choices: ['info', 'warning', 'error'], required: true, default: 'info' }),
		message: field.string({ required: true, length: 1024 }),
		data: field.json<Record<string, unknown>>(),
		createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
	}),
}) {}
