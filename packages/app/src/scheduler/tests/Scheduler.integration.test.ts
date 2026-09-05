import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveRecord, Database } from '../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import {
	type JobEnvelope,
	FailedJob,
	Queue,
	QueueableJob,
	type QueueDriver,
	type QueueDriverPopOptions,
	type QueueDriverPushInput,
	type QueueJob,
	type QueueJobId,
	type QueueableJobContext,
	QueuedJob,
} from '../../queue';
import { ScheduledOccurrence, Scheduler } from '..';

/**
 * Serializable job used to verify scheduled queue execution.
 */
class ScheduledRecordingJob extends QueueableJob {
	static handled = 0;

	/**
	 * Creates a recording job with an empty persisted payload.
	 */
	constructor() {
		super({});
	}

	/**
	 * Records one queue execution.
	 *
	 * @param _context - Queue runtime context.
	 */
	async handle(_context: QueueableJobContext): Promise<void> {
		ScheduledRecordingJob.handled += 1;
	}
}

/**
 * Serializable job that always fails for retry lifecycle assertions.
 */
class ScheduledFailingJob extends QueueableJob {
	/**
	 * Creates a failing job with an empty persisted payload.
	 */
	constructor() {
		super({});
	}

	/**
	 * Raises the deterministic test failure.
	 */
	async handle(): Promise<void> {
		throw new Error('Scheduled failure.');
	}
}

/**
 * In-memory queue persistence used while occurrence state remains in SQL.
 */
class SchedulerMemoryQueueDriver implements QueueDriver {
	readonly name = 'scheduler-memory';
	readonly jobs: QueueJob[] = [];
	readonly failed: QueueJob[] = [];
	private nextId = 1;

	/**
	 * Persists one queued job.
	 *
	 * @param input - Queue push payload.
	 * @returns Incrementing queue id.
	 */
	async push<TData extends Record<string, unknown>>(
		input: QueueDriverPushInput<TData>,
	): Promise<QueueJobId> {
		const id = this.nextId;

		this.nextId += 1;
		this.jobs.push({
			id,
			queue: input.queue,
			attempts: 0,
			payload: input.payload as JobEnvelope<Record<string, unknown>>,
		});

		return id;
	}

	/**
	 * Claims the first queued job.
	 *
	 * @param queue - Named queue to inspect.
	 * @param _options - Unused queue claim options.
	 * @returns Claimed job or null.
	 */
	async pop(
		queue: string,
		_options: QueueDriverPopOptions,
	): Promise<QueueJob | null> {
		const job = this.jobs.find(candidate => candidate.queue === queue);

		if (!job) return null;

		job.attempts += 1;

		return {
			...job,
			payload: {
				...job.payload,
				data: {
					...job.payload.data,
				},
			},
		};
	}

	/**
	 * Renews an owned in-memory scheduler job.
	 *
	 * @param job - Claimed queue job.
	 * @returns True when the attempt still owns the job.
	 */
	async touch(job: QueueJob): Promise<boolean> {
		return this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));
	}

	/**
	 * Removes a completed queue job.
	 *
	 * @param job - Completed queue job.
	 * @returns True when the attempt owned and deleted the job.
	 */
	async delete(job: QueueJob): Promise<boolean> {
		const index = this.jobs.findIndex(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (index < 0) return false;

		this.jobs.splice(index, 1);

		return true;
	}

	/**
	 * Stores a retry attempt for immediate test reprocessing.
	 *
	 * @param job - Released queue job.
	 * @returns True when the attempt owned and released the job.
	 */
	async release(job: QueueJob): Promise<boolean> {
		const stored = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!stored) return false;

		stored.attempts = job.attempts;

		return true;
	}

	/**
	 * Restores the consumed attempt for a deferred job.
	 *
	 * @param job - Deferred queue job.
	 * @returns True when the attempt owned and deferred the job.
	 */
	async defer(job: QueueJob): Promise<boolean> {
		const stored = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!stored) return false;

		stored.attempts = Math.max(0, job.attempts - 1);

		return true;
	}

	/**
	 * Moves a terminal failure out of the active test queue.
	 *
	 * @param job - Terminally failed queue job.
	 * @returns True when the attempt owned and failed the job.
	 */
	async fail(job: QueueJob): Promise<boolean> {
		const owned = this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!owned) return false;

		this.failed.push(job);

		return await this.delete(job);
	}
}

let generatedDatabase: GeneratedTestDatabase;
let database: Database;

/**
 * Reads all scheduled occurrences from the disposable database.
 *
 * @returns Scheduled occurrences in registration order.
 */
async function occurrences(): Promise<ScheduledOccurrence[]> {
	return await ActiveRecord.withDb(generatedDatabase.db, () => {
		return ScheduledOccurrence.query()
			.orderBy('claimedAt')
			.all();
	});
}

describe('Scheduler SQL occurrence lifecycle', () => {
	beforeAll(async () => {
		generatedDatabase = await createGeneratedTestDatabase('scheduler');
		database = new Database(generatedDatabase.db, {
			reportSchemaDiff: false,
		});
		await database.install(
			QueuedJob,
			FailedJob,
			ScheduledOccurrence,
		);
	});

	beforeEach(async () => {
		ScheduledRecordingJob.handled = 0;
		await ActiveRecord.withDb(generatedDatabase.db, () => {
			return Promise.all([
				ScheduledOccurrence.query().forceDelete(),
				QueuedJob.query().forceDelete(),
				FailedJob.query().forceDelete(),
			]);
		});
	});

	afterAll(async () => {
		await generatedDatabase?.destroy();
	});

	it('dispatches a due job and records queue success against its occurrence', async () => {
		const dispatchQueue = new Queue(database, {
			driver: 'database',
		});
		const scheduler = new Scheduler(database, dispatchQueue);

		scheduler.job(ScheduledRecordingJob)
			.dailyAt('02:00')
			.timezone('Europe/London');

		const result = await scheduler.runDue(
			new Date('2026-07-23T01:00:45.000Z'),
		);

		expect(result).toMatchObject({
			due: 1,
			claimed: 1,
			dispatched: 1,
			skipped: 0,
			failures: [],
		});
		const queuedJob = await ActiveRecord.withDb(generatedDatabase.db, () => {
			return QueuedJob.query().firstOrFail();
		});

		expect(queuedJob.payload?.origin).toEqual({
			type: 'scheduled-occurrence',
			id: expect.any(String),
		});
		expect((await occurrences())[0]).toMatchObject({
			name: 'ScheduledRecordingJob',
			status: 'queued',
			queueJobId: String(queuedJob.id),
			attempts: 0,
			maxTries: 3,
		});

		const workerQueue = new Queue(database, {
			driver: 'database',
		});
		const workerScheduler = new Scheduler(database, workerQueue);

		workerQueue.registerJob(ScheduledRecordingJob);

		await expect(workerQueue.workNextJob()).resolves.toMatchObject({
			status: 'succeeded',
		});

		expect(ScheduledRecordingJob.handled).toBe(1);
		expect((await occurrences())[0]).toMatchObject({
			status: 'succeeded',
			attempts: 1,
			finishedAt: expect.any(Date),
		});

		scheduler.close();
		workerScheduler.close();
	});

	it('allows only one scheduler process to claim the same named minute', async () => {
		const firstDriver = new SchedulerMemoryQueueDriver();
		const secondDriver = new SchedulerMemoryQueueDriver();
		const first = new Scheduler(database, new Queue(database, {
			driver: firstDriver,
		}));
		const second = new Scheduler(database, new Queue(database, {
			driver: secondDriver,
		}));
		const dueAt = new Date('2026-07-23T02:00:00.000Z');

		first.job(ScheduledRecordingJob).dailyAt('02:00');
		second.job(ScheduledRecordingJob).dailyAt('02:00');

		const [firstResult, secondResult] = await Promise.all([
			first.runDue(dueAt),
			second.runDue(dueAt),
		]);

		expect(firstResult.claimed + secondResult.claimed).toBe(1);
		expect(firstResult.skipped + secondResult.skipped).toBe(1);
		expect(firstDriver.jobs.length + secondDriver.jobs.length).toBe(1);
		expect(await occurrences()).toHaveLength(1);

		first.close();
		second.close();
	});

	it('records queue retries and terminal failure from a separate worker', async () => {
		const dispatchQueue = new Queue(database, {
			driver: 'database',
			retryDelaySeconds: 0,
		});
		const scheduler = new Scheduler(database, dispatchQueue);

		scheduler.job(ScheduledFailingJob).dailyAt('05:00');
		await scheduler.runDue(new Date('2026-07-23T05:00:00.000Z'));

		const workerQueue = new Queue(database, {
			driver: 'database',
		});
		const workerScheduler = new Scheduler(database, workerQueue);

		workerQueue.registerJob(ScheduledFailingJob);

		await expect(workerQueue.workNextJob()).resolves.toMatchObject({
			status: 'released',
		});
		expect((await occurrences())[0]).toMatchObject({
			status: 'retrying',
			attempts: 1,
			lastError: expect.stringContaining('Scheduled failure.'),
			nextAttemptAt: expect.any(Date),
		});

		await expect(workerQueue.workNextJob()).resolves.toMatchObject({
			status: 'released',
		});
		await expect(workerQueue.workNextJob()).resolves.toMatchObject({
			status: 'failed',
		});
		expect((await occurrences())[0]).toMatchObject({
			status: 'failed',
			attempts: 3,
			lastError: expect.stringContaining('Scheduled failure.'),
			finishedAt: expect.any(Date),
		});
		await expect(ActiveRecord.withDb(generatedDatabase.db, () => {
			return FailedJob.query().all();
		})).resolves.toHaveLength(1);

		scheduler.close();
		workerScheduler.close();
	});

	it('continues after an inline call fails and records both terminal states', async () => {
		const queue = new Queue(database, {
			driver: new SchedulerMemoryQueueDriver(),
		});
		const scheduler = new Scheduler(database, queue);
		const successfulCall = vi.fn(async () => {});

		scheduler.call(() => {
			throw new Error('Cleanup failed.');
		})
			.name('failing-cleanup')
			.dailyAt('04:30');
		scheduler.call(successfulCall)
			.name('successful-cleanup')
			.dailyAt('04:30');

		const result = await scheduler.runDue(
			new Date('2026-07-23T04:30:00.000Z'),
		);
		const records = await occurrences();

		expect(result).toMatchObject({
			due: 2,
			claimed: 2,
			completed: 1,
			failures: [{
				name: 'failing-cleanup',
				error: expect.stringContaining('Cleanup failed.'),
			}],
		});
		expect(successfulCall).toHaveBeenCalledOnce();
		expect(records.map(record => ({
			name: record.name,
			status: record.status,
		}))).toEqual([
			{
				name: 'failing-cleanup',
				status: 'failed',
			},
			{
				name: 'successful-cleanup',
				status: 'succeeded',
			},
		]);

		scheduler.close();
	});
});
