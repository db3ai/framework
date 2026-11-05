import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulid } from '@db3.ai/pure';
import { App } from '../../server/App';
import { createGeneratedTestDatabase } from '../../db/test/db';
import { JobRunAttempt, JobRunEvent, RunnableJob, pruneJobRuns } from '../index';

const DAY = 86_400_000;
const now = new Date('2026-11-05T12:00:00Z');

describe('pruneJobRuns', () => {
	let database: Awaited<ReturnType<typeof createGeneratedTestDatabase>>;
	let application: App;
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('prune_job_runs');
		application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false } });
		await application.db.install(RunnableJob, JobRunAttempt, JobRunEvent);
	});
	afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); } });

	/** Inserts one run of a given age with an attempt and an event. */
	async function run(jobType: string, status: string, ageDays: number): Promise<string> {
		const created = new Date(now.getTime() - ageDays * DAY);
		const id = ulid(created);
		await database.db(RunnableJob.table).insert({ id, job_type: jobType, tenant_id: 't', trigger: 'schedule', status, input: '{}', state: '{}', completed: 0, failures: 0, attempt_count: 1, created_at: created, updated_at: created });
		await database.db(JobRunAttempt.table).insert({ id: ulid(created), run_id: id, tenant_id: 't', attempt: 1, delivery_id: 'd', status, started_at: created });
		await database.db(JobRunEvent.table).insert({ id: ulid(created), run_id: id, tenant_id: 't', attempt: 1, level: 'info', message: 'done', created_at: created });
		return id;
	}

	it('deletes finished runs past their window with attempts and events, keeping failures and active runs longer', async () => {
		const keep = [
			await run('Report', 'completed', 29),
			await run('Report', 'failed', 89),
			await run('Report', 'waiting', 400),
			await run('Report', 'running', 400),
			await run('Report', 'blocked', 400),
			await run('Tick', 'completed', 6),
		];
		const drop = [
			await run('Report', 'completed', 31),
			await run('Report', 'cancelled', 31),
			await run('Report', 'failed', 91),
			await run('Tick', 'completed', 8),
			await run('Tick', 'failed', 91),
		];

		const deleted = await pruneJobRuns({ completedDays: 30, failedDays: 90, jobTypes: { Tick: 7 } }, now);

		expect(deleted).toBe(drop.length);
		const remaining = (await database.db(RunnableJob.table).select('id')).map(row => row.id).sort();
		expect(remaining).toEqual([...keep].sort());
		expect(await database.db(JobRunAttempt.table).whereIn('run_id', drop).count({ n: '*' })).toEqual([{ n: 0 }]);
		expect(await database.db(JobRunEvent.table).whereIn('run_id', drop).count({ n: '*' })).toEqual([{ n: 0 }]);
		expect(await database.db(JobRunEvent.table).whereIn('run_id', keep).count({ n: '*' })).toEqual([{ n: keep.length }]);
	}, 30_000);

	it('works through more rows than one batch', async () => {
		await database.db(JobRunEvent.table).delete();
		await database.db(JobRunAttempt.table).delete();
		await database.db(RunnableJob.table).delete();
		const created = new Date(now.getTime() - 40 * DAY);
		await database.db(RunnableJob.table).insert(Array.from({ length: 1_203 }, (_, index) => ({
			id: ulid(created.getTime() + index), job_type: 'Bulk', tenant_id: 't', trigger: 'schedule', status: 'completed',
			input: '{}', state: '{}', completed: 0, failures: 0, attempt_count: 1, created_at: created, updated_at: created,
		})));
		expect(await pruneJobRuns(undefined, now)).toBe(1_203);
	}, 30_000);

	it('rejects retention under a day', async () => {
		await expect(pruneJobRuns({ completedDays: 0, failedDays: 90 }, now)).rejects.toThrow('at least one day');
	});
});
