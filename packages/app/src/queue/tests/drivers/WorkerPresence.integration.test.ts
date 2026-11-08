import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Database } from '../../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../../db/test/db';
import { DatabaseQueueDriver, FailedJob, Queue, QueuedJob, QueueWorker, QueueWorkerRecord } from '../../index';

describe('database worker presence', () => {
	let generated: GeneratedTestDatabase;
	let database: Database;

	beforeAll(async () => {
		generated = await createGeneratedTestDatabase('database_queue_presence');
		database = new Database(generated.db, { reportSchemaDiff: false });
		await database.install(QueuedJob, FailedJob);
	});

	afterAll(async () => {
		await generated?.destroy();
	});

	it('skips apps without the presence table, then records idle, busy and finished counts once it exists', async () => {
		const driver = new DatabaseQueueDriver(database);
		const queue = new Queue(database, { driver, queueMonitor: false });
		const before = new QueueWorker(queue, 'mail');
		await expect(before.workOnce()).resolves.toBeNull();
		expect(await generated.db.schema.hasTable('jobs_workers')).toBe(false);

		await database.install(QueueWorkerRecord);
		const fresh = new DatabaseQueueDriver(database);
		const live = new Queue(database, { driver: fresh, queueMonitor: false });
		let seen: Record<string, unknown> | undefined;
		// Presence writes are fire-and-forget, so wait for the busy row the claim publishes.
		live.registerHandler('send-mail', async () => {
			for (let tries = 0; tries < 100 && seen?.status !== 'busy'; tries++) {
				seen = await generated.db('jobs_workers').first();
				if (seen?.status !== 'busy') await new Promise(resolve => setTimeout(resolve, 20));
			}
		});
		live.registerHandler('broken', async () => { throw new Error('No mailbox'); });
		await live.dispatch('send-mail', {}, { queue: 'mail' });
		await live.dispatch('broken', {}, { queue: 'mail', maxTries: 1 });
		const worker = new QueueWorker(live, { queues: ['mail', 'reports'], excludeQueues: [] });
		await worker.workOnce();
		expect(seen).toMatchObject({ status: 'busy', current_queue: 'mail', processed: 0 });
		expect(JSON.parse(String(seen!.selection))).toEqual({ queues: ['mail', 'reports'], excludeQueues: [] });
		await worker.workOnce();
		await worker.stop();
		const rows = await generated.db('jobs_workers').select();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'stopped', processed: 1, failed: 1, current_queue: null });
		expect(rows[0].last_job_at).toBeGreaterThan(0);
		expect(rows[0].heartbeat_at).toBeGreaterThanOrEqual(rows[0].started_at);
		expect(rows[0]).toMatchObject({ busy: 0, slots: 1 });
	});

	it('records a pool of slots as one row with its slot count', async () => {
		await generated.db('jobs_workers').delete();
		const queue = new Queue(database, { driver: new DatabaseQueueDriver(database), queueMonitor: false });
		const pool = new QueueWorker(queue, { queues: ['reports'], concurrency: 8, intervalMs: 100 });
		pool.start();
		for (let tries = 0; tries < 100 && !(await generated.db('jobs_workers').first()); tries++) await new Promise(resolve => setTimeout(resolve, 20));
		await pool.stopAndDrain();
		const rows = await generated.db('jobs_workers').select();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'stopped', busy: 0, slots: 8 });
	});
});
