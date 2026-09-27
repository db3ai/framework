import { ActiveRecord, RecordValidationError, withQueryMonitorCategory, type Database, type FieldError } from '../../db';
import { FailedJob } from '../FailedJob';
import { QueuedJob } from '../QueuedJob';
import type * as queue from '../contracts';
import { jobEnvelopeHasPrefix } from '../jobEnvelopeHasPrefix';

/**
 * Queue driver that stores pending and failed jobs in the app database.
 */
export class DatabaseQueueDriver implements queue.QueueDriver {
	readonly name = 'database';

	/**
	 * Creates a database-backed queue driver.
	 *
	 * @param db - Database service used for queue persistence.
	 */
	constructor(private readonly db: Database) {}

	/** Scans active work in bounded pages during quiesced maintenance, including delayed and chained payloads. */
	async hasPendingJobs(jobPrefix: string): Promise<boolean> {
		if (!(await this.db.knex.schema.hasTable(QueuedJob.table))) return false;
		let after: number | string = 0;
		while (true) {
			const rows = await this.db.knex(QueuedJob.table).select('id', 'payload').where('id', '>', after).orderBy('id').limit(100);
			for (const row of rows) if (jobEnvelopeHasPrefix(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload, jobPrefix)) return true;
			if (rows.length < 100) return false;
			after = rows[rows.length - 1].id;
		}
	}

	/**
	 * Persists a job in the `jobs` table.
	 *
	 * @param job - Queue job payload and scheduling data.
	 * @returns Database id of the queued job record.
	 */
	async push<TData extends Record<string, unknown>>(
		job: queue.QueueDriverPushInput<TData>,
	): Promise<queue.QueueJobId> {
		const connection = ActiveRecord.getScopedDb() ?? this.db.knex;
		return withQueueQueryCategory(() => ActiveRecord.withDb(connection, async () => {
			const record = QueuedJob.create({
				queue: job.queue,
				payload: job.payload,
				attempts: 0,
				reservedAt: null,
				availableAt: job.createdAt + job.delaySeconds,
				createdAt: job.createdAt,
			});

			const valid = await record.validate();

			if (!valid) {
				throw new RecordValidationError(record.getErrors());
			}

			const row = await record.getDataForDb({
				isInsert: true,
				onlyDirty: false,
			});
			const [jobId] = await connection(QueuedJob.table).insert(row);

			return Number(jobId);
		}));
	}

	/**
	 * Claims the next available job from a named queue.
	 *
	 * @param queue - Named queue/channel to claim from.
	 * @param options - Claim controls such as retry expiry.
	 * @returns Claimed queue job, or null when no job is ready.
	 */
	async pop(
		queue: string,
		options: queue.QueueDriverPopOptions,
	): Promise<queue.QueueJob | null> {
		const now = unixTimestamp();
		const expiredAt = now - options.retryAfterSeconds;

		return withQueueQueryCategory(() => this.db.transaction(async () => {
			const row = await QueuedJob
				.where('queue', queue)
				.where('availableAt', '<=', now)
				.orderBy('id')
				.toKnex()
				.where(builder => {
					builder
						.whereNull('reserved_at')
						.orWhere('reserved_at', '<=', expiredAt);
				})
				.forUpdate()
				.skipLocked()
				.first();

			if (!row) return null;

			const record = QueuedJob.fromDb(row);
			const attempts = Number(record.attempts ?? 0) + 1;

			await QueuedJob
				.where('id', record.id)
				.patch({
					attempts,
					reservedAt: now,
				});

			return {
				id: Number(record.id),
				queue: String(record.queue),
				attempts,
				payload: parsePayload(record.payload),
			};
		}));
	}

	/**
	 * Renews the reservation for the current database queue attempt.
	 *
	 * @param job - Claimed job whose id and attempt count identify the lease owner.
	 * @param _retryAfterSeconds - Lease duration used by queue polling expiry checks.
	 * @returns True when the current attempt still owns the job.
	 */
	async touch(job: queue.QueueJob, _retryAfterSeconds: number): Promise<boolean> {
		return withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const updated = await QueuedJob
				.where('id', job.id)
				.where('attempts', job.attempts)
				.patch({
					reservedAt: unixTimestamp(),
				});

			return updated === 1;
		}));
	}

	/**
	 * Moves a terminally failed job to `jobs_failed` and removes it from `jobs`.
	 *
	 * @param job - Claimed queue job that exhausted retries.
	 * @param error - Error thrown by the job handler.
	 * @returns True when the current attempt owned and failed the job.
	 */
	async fail(job: queue.QueueJob, error: unknown): Promise<boolean> {
		return await withQueueQueryCategory(() => this.db.transaction(async () => {
			const deleted = await QueuedJob
				.where('id', job.id)
				.where('attempts', job.attempts)
				.delete();

			if (deleted !== 1) return false;

			const failedJob = FailedJob.create({
				uuid: job.payload.uuid,
				connection: this.name,
				queue: job.queue,
				payload: job.payload,
				exception: errorStack(error),
				failedAt: new Date(),
			});

			await failedJob.save();

			return true;
		}));
	}

	/**
	 * Releases a failed attempt for another try after a delay.
	 *
	 * @param job - Claimed queue job to release.
	 * @param delaySeconds - Number of seconds before the job can be claimed again.
	 * @returns True when the current attempt owned and released the job.
	 */
	async release(job: queue.QueueJob, delaySeconds: number): Promise<boolean> {
		return await withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const updated = await QueuedJob
				.where('id', job.id)
				.where('attempts', job.attempts)
				.patch({
					reservedAt: null,
					availableAt: unixTimestamp() + delaySeconds,
				});

			return updated === 1;
		}));
	}

	/**
	 * Defers a claimed job without consuming one of its retry attempts.
	 *
	 * @param job - Claimed queue job.
	 * @param delaySeconds - Number of seconds before the job can be claimed again.
	 * @returns True when the current attempt owned and deferred the job.
	 */
	async defer(job: queue.QueueJob, delaySeconds: number): Promise<boolean> {
		return await withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const updated = await QueuedJob
				.where('id', job.id)
				.where('attempts', job.attempts)
				.patch({
					attempts: Math.max(0, job.attempts - 1),
					reservedAt: null,
					availableAt: unixTimestamp() + delaySeconds,
				});

			return updated === 1;
		}));
	}

	/**
	 * Deletes a completed job from the active queue table.
	 *
	 * @param job - Claimed queue job to delete.
	 * @returns True when the current attempt owned and deleted the job.
	 */
	async delete(job: queue.QueueJob): Promise<boolean> {
		return await withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const deleted = await QueuedJob
				.where('id', job.id)
				.where('attempts', job.attempts)
				.delete();

			return deleted === 1;
		}));
	}

	/**
	 * Returns recent terminal failures for queue monitoring and diagnostics.
	 *
	 * @param limit - Maximum number of recent failed jobs to return.
	 * @returns Recent failed jobs ordered from newest to oldest.
	 */
	async failedJobs(limit = 100): Promise<queue.QueueFailedJob[]> {
		return withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const records = await FailedJob
				.query()
				.orderBy('failedAt', 'desc')
				.limit(normalizeFailureLimit(limit))
				.all();

			return records.map(queueFailedJobFromRecord);
		}));
	}

	/**
	 * Returns one terminal failure by its database identifier.
	 *
	 * @param id - Failed-job table identifier.
	 * @returns Persisted failed job, or null when it does not exist.
	 */
	async failedJob(id: queue.QueueJobId): Promise<queue.QueueFailedJob | null> {
		return withQueueQueryCategory(() => ActiveRecord.withDb(this.db.knex, async () => {
			const record = await FailedJob.find(id);

			return record ? queueFailedJobFromRecord(record) : null;
		}));
	}
}

/**
 * Runs queue persistence inside the query-monitor category hidden by the dev panel.
 *
 * @param callback - Queue database operation to execute.
 * @returns The callback result.
 */
function withQueueQueryCategory<TResult>(callback: () => TResult): TResult {
	return withQueryMonitorCategory('queue', callback);
}

/**
 * Normalizes the number of stored failures returned to development tooling.
 *
 * @param limit - Requested maximum failure count.
 * @returns Positive bounded failure count.
 */
function normalizeFailureLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 100;

	return Math.min(500, Math.max(1, Math.trunc(limit)));
}

/**
 * Converts a failed-job ActiveRecord into the driver-independent contract.
 *
 * @param record - Persisted failed queue record.
 * @returns Serialized terminal queue failure.
 */
function queueFailedJobFromRecord(record: FailedJob): queue.QueueFailedJob {
	return {
		id: Number(record.id),
		connection: String(record.connection),
		queue: String(record.queue),
		payload: parsePayload(record.payload),
		exception: String(record.exception),
		failedAt: failedAtIso(record.failedAt),
	};
}

/**
 * Converts a failed-job timestamp into the serialized driver contract.
 *
 * @param value - Timestamp converted by the failed-job model.
 * @returns ISO failed-job timestamp.
 */
function failedAtIso(value: Date | null): string {
	return value instanceof Date && !Number.isNaN(value.getTime())
		? value.toISOString()
		: new Date(0).toISOString();
}

/**
 * Returns the current Unix timestamp in seconds for queue scheduling fields.
 *
 * @returns Current Unix timestamp in seconds.
 */
function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Formats an error for failed job storage.
 *
 * @param error - Unknown handler error.
 * @returns Stack or message with validation details when available.
 */
function errorStack(error: unknown): string {
	const details = validationErrorDetails(error);
	const message = error instanceof Error ? error.stack || error.message : String(error);

	if (details.length === 0 || message.includes('Validation errors:')) {
		return message;
	}

	return [
		message,
		'',
		'Validation errors:',
		...details.map(detail => `- ${detail}`),
	].join('\n');
}

/**
 * Validates and returns a stored queue payload.
 *
 * @param payload - Payload read from the queued job record.
 * @returns Valid queue payload envelope.
 */
function parsePayload<TData>(payload: queue.JobEnvelope<TData> | null): queue.JobEnvelope<TData> {
	if (!payload || !payload.job || typeof payload.job !== 'string') {
		throw new Error('Queued job payload is missing a job name.');
	}

	return payload;
}

/**
 * Extracts nested field validation errors from an unknown error.
 *
 * @param error - Unknown error value.
 * @returns Flattened validation error details.
 */
function validationErrorDetails(error: unknown): string[] {
	const errors = fieldErrorsFrom(error);

	if (errors.length > 0) {
		return errors.map(formatFieldError);
	}

	if (error && typeof error === 'object' && 'cause' in error) {
		return validationErrorDetails((error as { cause?: unknown }).cause);
	}

	return [];
}

/**
 * Returns field validation errors attached to an error object.
 *
 * @param error - Unknown error value.
 * @returns Field validation errors, or an empty array.
 */
function fieldErrorsFrom(error: unknown): FieldError[] {
	if (!error || typeof error !== 'object') return [];

	const errors = (error as { errors?: unknown }).errors;

	if (!Array.isArray(errors) || !errors.every(isFieldError)) {
		return [];
	}

	return errors;
}

/**
 * Checks whether a value has the framework field error shape.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a field error.
 */
function isFieldError(value: unknown): value is FieldError {
	return (
		typeof value === 'object'
		&& value !== null
		&& typeof (value as FieldError).field === 'string'
		&& typeof (value as FieldError).message === 'string'
	);
}

/**
 * Formats one field validation error for failed job diagnostics.
 *
 * @param error - Field error to format.
 * @returns Human-readable validation error.
 */
function formatFieldError(error: FieldError): string {
	const details = [
		error.code ? `code: ${error.code}` : null,
		Object.prototype.hasOwnProperty.call(error, 'value')
			? `value: ${formatValidationValue(error.value)}`
			: null,
		error.details !== undefined
			? `details: ${formatValidationValue(error.details)}`
			: null,
	].filter((value): value is string => Boolean(value));

	return details.length
		? `${error.field}: ${error.message} (${details.join(', ')})`
		: `${error.field}: ${error.message}`;
}

/**
 * Formats an arbitrary validation detail value.
 *
 * @param value - Unknown validation detail value.
 * @returns String representation safe for failed job storage.
 */
function formatValidationValue(value: unknown): string {
	if (value === undefined) return 'undefined';

	try {
		const serialized = JSON.stringify(value);

		return truncateValidationValue(serialized === undefined ? String(value) : serialized);
	} catch {
		return truncateValidationValue(String(value));
	}
}

/**
 * Bounds long validation values before storing them in failed job output.
 *
 * @param value - Value to truncate.
 * @returns Original or truncated value.
 */
function truncateValidationValue(value: string): string {
	const maxLength = 500;

	if (value.length <= maxLength) return value;

	return `${value.slice(0, maxLength - 3)}...`;
}
