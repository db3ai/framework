import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../server/App';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { QueueWorker, QueueableJob, QueuedJob, FailedJob } from '../index';

const started: number[] = [];
const gates = new Map<number, ReturnType<typeof jobGate>>();

/** Holds real queue handlers at an asynchronous boundary, without replacing queue internals. */
class ConcurrentWaitingJob extends QueueableJob<{ number: number }> {
	/** Records admission and waits for this test's simulated I/O completion. */
	async handle(): Promise<void> { started.push(this.data.number); await gates.get(this.data.number)!.promise; }
}

let database: GeneratedTestDatabase;
let application: App;
let worker: QueueWorker | undefined;
beforeAll(async () => {
	database = await createGeneratedTestDatabase('worker_concurrency');
	application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(QueuedJob, FailedJob);
	application.queue.registerJob(ConcurrentWaitingJob);
});
afterEach(async () => { for (const gate of gates.values()) gate.resolve(); await worker?.stopAndDrain(); worker = undefined; gates.clear(); started.length = 0; await QueuedJob.query().delete(); });
afterAll(async () => { await application?.close(); await database?.destroy(); });

describe('bounded in-process queue concurrency', () => {
	it('overlaps I/O up to its limit, refills a free slot and drains every active job before stopping', async () => {
		for (const number of [1, 2, 3, 4]) {
			gates.set(number, jobGate());
			await application.queue.dispatch(new ConcurrentWaitingJob({ number }), { queue: 'images' });
		}
		worker = new QueueWorker(application.queue, { queues: ['images'], concurrency: 2 }, 100);
		worker.start();
		await vi.waitFor(() => expect(started).toHaveLength(2));
		expect(new Set(started).size).toBe(2);
		gates.get(started[0]!)!.resolve();
		await vi.waitFor(() => expect(started).toHaveLength(3));
		let drained = false;
		const draining = worker.stopAndDrain().then(() => { drained = true; });
		await new Promise(resolve => setTimeout(resolve, 150));
		expect(drained).toBe(false);
		for (const number of started) gates.get(number)!.resolve();
		await draining;
		expect(started).toHaveLength(3);
		expect(await QueuedJob.where('queue', 'images').count()).toBe(1);
	}, 10000);

	it('keeps one-shot execution bounded and drains it even with multiple configured slots', async () => {
		gates.set(1, jobGate());
		await application.queue.dispatch(new ConcurrentWaitingJob({ number: 1 }), { queue: 'images' });
		worker = new QueueWorker(application.queue, { queues: ['images'], concurrency: 2 }, 100);
		const running = worker.workOnce();
		await vi.waitFor(() => expect(started).toEqual([1]));
		expect(() => worker!.start()).toThrow('already processing');
		await expect(worker.workOnce()).rejects.toThrow('already processing');
		let drained = false;
		const draining = worker.stopAndDrain().then(() => { drained = true; });
		await new Promise(resolve => setTimeout(resolve, 150));
		expect(drained).toBe(false);
		gates.get(1)!.resolve();
		await running;
		await draining;
		expect(drained).toBe(true);
	});

	it.each([0, -1, 1.5, 33, NaN])('rejects invalid concurrency %s', concurrency => {
		expect(() => new QueueWorker(application.queue, { concurrency })).toThrow('concurrency');
	});
});

/** Controls deterministic test I/O without replacing the queue or its handlers. */
function jobGate(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
