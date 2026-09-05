import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	RecordValidationError,
	type Database,
} from '../../../db';
import {
	DatabaseQueueDriver,
	FailedJob,
	QueuedJob,
	type QueueJob,
} from '../../index';

describe('DatabaseQueueDriver', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('stores exhausted jobs in the queue-owned failures table', () => {
		expect(FailedJob.table).toBe('jobs_failed');
	});

	it('stores validation field details in failed job exceptions', async () => {
		const db = {
			transaction: async <TResult>(callback: () => Promise<TResult>): Promise<TResult> => {
				return callback();
			},
		} as Database;
		vi.spyOn(FailedJob, 'create').mockImplementation(input => {
			return new FailedJob(input, {
				db: {} as never,
			}) as never;
		});
		const saveSpy = vi.spyOn(FailedJob.prototype, 'save').mockImplementation(async function save() {
			return this;
		});
		const remove = vi.fn(async () => 1);
		const attemptWhere = vi.fn(() => ({ delete: remove }));
		const idWhere = vi.spyOn(QueuedJob, 'where').mockReturnValue({
			where: attemptWhere,
		} as never);

		const failed = await new DatabaseQueueDriver(db).fail(testJob(), new RecordValidationError([
			{
				field: 'request',
				message: 'request is required',
				code: 'required',
				value: null,
			},
			{
				field: 'status',
				message: 'status must be one of pending, completed, failed',
				code: 'choice',
				details: {
					choices: ['pending', 'completed', 'failed'],
				},
			},
		]));

		const failedJob = saveSpy.mock.instances[0] as FailedJob;

		expect(failed).toBe(true);
		expect(idWhere).toHaveBeenCalledWith('id', 1);
		expect(attemptWhere).toHaveBeenCalledWith('attempts', 1);
		expect(failedJob.exception).toContain('RecordValidationError: Record validation failed');
		expect(failedJob.exception).toContain('Validation errors:');
		expect(failedJob.exception).toContain(
			'- request: request is required (code: required, value: null)',
		);
		expect(failedJob.exception).toContain(
			'- status: status must be one of pending, completed, failed (code: choice, details: {"choices":["pending","completed","failed"]})',
		);
	});

	it('defers jobs by restoring attempts and moving availability forward', async () => {
		const db = {
			knex: vi.fn(),
		} as unknown as Database;
		const patch = vi.fn(async () => 1);
		const attemptsWhere = vi.fn(() => ({ patch }));
		const idWhere = vi.spyOn(QueuedJob, 'where').mockReturnValue({
			where: attemptsWhere,
		} as never);

		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		await expect(new DatabaseQueueDriver(db).defer({
			...testJob(),
			attempts: 3,
		}, 42)).resolves.toBe(true);

		expect(idWhere).toHaveBeenCalledWith('id', 1);
		expect(attemptsWhere).toHaveBeenCalledWith('attempts', 3);
		expect(patch).toHaveBeenCalledWith({
			attempts: 2,
			reservedAt: null,
			availableAt: 1_700_000_042,
		});
	});

	it('refuses terminal mutations from a stale database queue attempt', async () => {
		const db = {
			knex: vi.fn(),
			transaction: async <TResult>(callback: () => Promise<TResult>): Promise<TResult> => {
				return await callback();
			},
		} as unknown as Database;
		const patch = vi.fn(async () => 0);
		const remove = vi.fn(async () => 0);
		const attemptsWhere = vi.fn(() => ({
			delete: remove,
			patch,
		}));
		const idWhere = vi.spyOn(QueuedJob, 'where').mockReturnValue({
			where: attemptsWhere,
		} as never);
		const save = vi.spyOn(FailedJob.prototype, 'save');
		const driver = new DatabaseQueueDriver(db);
		const job = testJob();

		await expect(driver.release(job, 10)).resolves.toBe(false);
		await expect(driver.defer(job, 10)).resolves.toBe(false);
		await expect(driver.delete(job)).resolves.toBe(false);
		await expect(driver.fail(job, new Error('Stale failure'))).resolves.toBe(false);

		expect(idWhere).toHaveBeenCalledTimes(4);
		expect(attemptsWhere).toHaveBeenCalledTimes(4);
		expect(save).not.toHaveBeenCalled();
	});

	it('renews only the current database queue attempt', async () => {
		const db = {
			knex: vi.fn(),
		} as unknown as Database;
		const patch = vi.fn(async () => 1);
		const attemptsWhere = vi.fn(() => ({ patch }));
		const idWhere = vi.fn(() => ({ where: attemptsWhere }));

		vi.spyOn(QueuedJob, 'where').mockImplementation(idWhere as never);
		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		await expect(new DatabaseQueueDriver(db).touch(testJob(), 90)).resolves.toBe(true);
		expect(idWhere).toHaveBeenCalledWith('id', 1);
		expect(attemptsWhere).toHaveBeenCalledWith('attempts', 1);
		expect(patch).toHaveBeenCalledWith({
			reservedAt: 1_700_000_000,
		});
	});

	it('returns recent persisted failures through the driver capability', async () => {
		const db = {
			knex: vi.fn(),
		} as unknown as Database;
		const all = vi.fn(async () => [
			{
				id: 7,
				connection: 'database',
				queue: 'default',
				payload: testJob().payload,
				exception: 'Stored failure',
				failedAt: new Date('2026-07-20T12:00:00.000Z'),
			},
		]);
		const limit = vi.fn(() => ({ all }));
		const orderBy = vi.fn(() => ({ limit }));

		vi.spyOn(FailedJob, 'query').mockReturnValue({ orderBy } as never);

		const failures = await new DatabaseQueueDriver(db).failedJobs(25);

		expect(orderBy).toHaveBeenCalledWith('failedAt', 'desc');
		expect(limit).toHaveBeenCalledWith(25);
		expect(failures).toEqual([
			{
				id: 7,
				connection: 'database',
				queue: 'default',
				payload: testJob().payload,
				exception: 'Stored failure',
				failedAt: '2026-07-20T12:00:00.000Z',
			},
		]);
	});

	it('returns one persisted failure for replay without deleting it', async () => {
		const db = {
			knex: vi.fn(),
		} as unknown as Database;
		const record = new FailedJob({
			id: 7,
			uuid: 'failed-job-uuid',
			connection: 'database',
			queue: 'default',
			payload: testJob().payload,
			exception: 'Stored failure',
			failedAt: new Date('2026-07-20T12:00:00.000Z'),
		}, {
			db: {} as never,
		});

		vi.spyOn(FailedJob, 'find').mockResolvedValue(record);

		await expect(new DatabaseQueueDriver(db).failedJob(7)).resolves.toEqual({
			id: 7,
			connection: 'database',
			queue: 'default',
			payload: testJob().payload,
			exception: 'Stored failure',
			failedAt: '2026-07-20T12:00:00.000Z',
		});
		expect(FailedJob.find).toHaveBeenCalledWith(7);
	});
});

/**
 * Builds a minimal queue job for database driver failure assertions.
 */
function testJob(): QueueJob {
	return {
		id: 1,
		queue: 'default',
		attempts: 1,
		payload: {
			uuid: 'test-job-uuid',
			displayName: 'FailingJob',
			job: 'FailingJob',
			maxTries: 1,
			data: {},
		},
	};
}
