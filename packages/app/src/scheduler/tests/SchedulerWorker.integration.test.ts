import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob, QueueableJob } from '@db3.ai/app/queue';
import { runSchedulerConsole, ScheduledOccurrence, SchedulerWorker, type SchedulerCheckpoint, type SchedulerRunResult } from '@db3.ai/app/scheduler';
import { App } from '@db3.ai/app/server';

/** Real serializable SQL job used to verify scheduling independently of execution. */
class WindowJob extends QueueableJob {
	/** Supplies a durable, empty payload. */
	constructor() { super({}); }
	/** Completes without external effects when processed by the queue. */
	async handle(): Promise<void> {}
}

let database: GeneratedTestDatabase;
let application: App;
let worker: SchedulerWorker;
let currentTime: number;
let ticks: SchedulerRunResult[];
let errors: string[];
const minute = 60_000;
const noon = Date.parse('2026-09-24T12:00:00Z');

/** Registers one real job at a selected UTC minute. */
function schedule(name: string, time = '12:00'): void {
	application.scheduler.job(WindowJob).name(name).dailyAt(time);
}

/** Builds a clock-controlled worker that fails fast if a test unexpectedly waits. */
function createWorker(options: ConstructorParameters<typeof SchedulerWorker>[1] = {}): SchedulerWorker {
	return new SchedulerWorker(application.scheduler, {
		now: () => new Date(currentTime),
		onTick: async result => { ticks.push(result); },
		sleep: async () => { throw new Error('Unexpected scheduler sleep.'); },
		logger: { info() {}, warn() {}, error(message) { errors.push(message); } },
		...options,
	});
}

/** Reads actual persisted dispatches in due-minute order. */
async function occurrences(): Promise<ScheduledOccurrence[]> {
	return await ScheduledOccurrence.query().orderBy('scheduledFor').orderBy('name').all();
}

describe('SchedulerWorker elapsed-minute coverage with a real SQL queue', () => {
	beforeAll(async () => { database = await createGeneratedTestDatabase('scheduler_window'); });
	beforeEach(async () => {
		application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false } });
		await application.db.install(QueuedJob, FailedJob, ScheduledOccurrence);
		await ScheduledOccurrence.query().forceDelete();
		await QueuedJob.query().forceDelete();
		await FailedJob.query().forceDelete();
		currentTime = noon;
		ticks = [];
		errors = [];
	});
	afterEach(async () => { worker?.stop(); await application?.close(); });
	afterAll(async () => { await database?.destroy(); });

	it('covers midnight crossed between evaluation and the heartbeat', async () => {
		currentTime = Date.parse('2026-09-23T22:59:59.999Z');
		application.scheduler.job(WindowJob).daily().timezone('Europe/London');
		worker = createWorker({ onTick: async result => {
			ticks.push(result);
			if (ticks.length === 1) currentTime += 3;
			else worker.stop();
		} });
		await worker.start();
		expect(ticks.map(tick => tick.evaluatedFor.toISOString())).toEqual(['2026-09-23T22:59:00.000Z', '2026-09-23T23:00:00.000Z']);
		expect(await QueuedJob.query().count()).toBe(1);
		expect((await occurrences())[0]).toMatchObject({ status: 'queued', scheduledFor: new Date('2026-09-23T23:00:00Z') });
	});

	it('queues all ten jobs for their original minute and catches minutes crossed during dispatch', async () => {
		for (let index = 0; index < 10; index++) schedule(`noon-${index}`);
		schedule('next-minute', '12:01');
		schedule('following-minute', '12:02');
		const unsubscribe = application.queue.events.subscribe(async event => {
			if (event.action === 'dispatched') currentTime += 13_000;
		});
		worker = createWorker({ onTick: async result => {
			ticks.push(result);
			if (result.evaluatedFor.getTime() === noon + 2 * minute) worker.stop();
		} });
		try { await worker.start(); } finally { unsubscribe(); }
		const recorded = await occurrences();
		expect(recorded).toHaveLength(12);
		expect(recorded.filter(record => record.name?.startsWith('noon-')).every(record => record.scheduledFor?.getTime() === noon)).toBe(true);
		expect(ticks.map(tick => [tick.evaluatedFor.getTime(), tick.dispatched])).toEqual([[noon, 10], [noon + minute, 1], [noon + 2 * minute, 1]]);
		expect(await QueuedJob.query().count()).toBe(12);
		for (let index = 0; index < 12; index++) expect(await application.queue.workNextJob()).toMatchObject({ status: 'succeeded' });
		expect((await occurrences()).every(record => record.status === 'succeeded')).toBe(true);
	});

	it('covers every elapsed minute after a late timer without discarding a long backlog', async () => {
		schedule('one-minute', '12:01');
		schedule('middle-minute', '12:45');
		schedule('last-minute', '14:01');
		const waits: number[] = [];
		worker = createWorker({
			onTick: async result => {
				ticks.push(result);
				if (ticks.length === 122) worker.stop();
			},
			sleep: async delay => { waits.push(delay); currentTime = noon + 121 * minute; },
		});
		await worker.start();
		expect(ticks.map(tick => tick.evaluatedFor.getTime())).toEqual(Array.from({ length: 122 }, (_, index) => noon + index * minute));
		expect(waits).toEqual([minute, 1, 1]);
		expect(await QueuedJob.query().count()).toBe(3);
	});

	it('waits again after an early timer and does not repeat an already evaluated minute', async () => {
		schedule('noon');
		schedule('next', '12:01');
		const waits: number[] = [];
		worker = createWorker({
			onTick: async result => { ticks.push(result); if (ticks.length === 2) worker.stop(); },
			sleep: async delay => { waits.push(delay); currentTime += waits.length === 1 ? delay - 1 : delay; },
		});
		await worker.start();
		expect(waits).toEqual([minute, 1]);
		expect(ticks.map(tick => tick.evaluatedFor.getTime())).toEqual([noon, noon + minute]);
		expect(await QueuedJob.query().count()).toBe(2);
	});

	it('waits through a backward clock step without duplicating completed minutes', async () => {
		schedule('noon');
		schedule('next', '12:01');
		const waits: number[] = [];
		worker = createWorker({
			onTick: async result => {
				ticks.push(result);
				if (ticks.length === 1) currentTime -= 2 * minute;
				else worker.stop();
			},
			sleep: async delay => { waits.push(delay); currentTime += delay; },
		});
		await worker.start();
		expect(waits).toEqual([minute, minute, minute]);
		expect(ticks.map(tick => tick.evaluatedFor.getTime())).toEqual([noon, noon + minute]);
		expect(await QueuedJob.query().count()).toBe(2);
	});

	it('retries a failed progress save without duplicating already queued jobs', async () => {
		for (let index = 0; index < 10; index++) schedule(`noon-${index}`);
		let saves = 0;
		const checkpoint: SchedulerCheckpoint = {
			async load(firstMinute) { return new Date(firstMinute.getTime() - minute); },
			async save() { if (++saves === 1) throw new Error('Progress storage unavailable.'); worker.stop(); },
		};
		worker = createWorker({ checkpoint, sleep: async delay => { expect(delay).toBe(1000); currentTime += delay; } });
		await worker.start();
		expect(saves).toBe(2);
		expect(ticks.map(tick => [tick.dispatched, tick.skipped])).toEqual([[10, 0], [0, 10]]);
		expect(await QueuedJob.query().count()).toBe(10);
		expect(errors).toHaveLength(1);
	});

	it('retries the same minute after an occurrence-store outage, then covers later minutes', async () => {
		for (let index = 0; index < 10; index++) schedule(`noon-${index}`);
		schedule('next', '12:01');
		let dispatched = 0;
		const unsubscribe = application.queue.events.subscribe(async event => {
			if (event.action === 'dispatched' && ++dispatched === 3) {
				await database.db.schema.renameTable(ScheduledOccurrence.table, 'temporarily_unavailable_occurrences');
			}
		});
		worker = createWorker({
			onTick: async result => { ticks.push(result); if (ticks.length === 2) worker.stop(); },
			sleep: async delay => {
				expect(delay).toBe(1000);
				await database.db.schema.renameTable('temporarily_unavailable_occurrences', ScheduledOccurrence.table);
				currentTime += minute;
			},
		});
		try { await worker.start(); } finally {
			unsubscribe();
			if (await database.db.schema.hasTable('temporarily_unavailable_occurrences')) {
				await database.db.schema.renameTable('temporarily_unavailable_occurrences', ScheduledOccurrence.table);
			}
		}
		expect(ticks.map(tick => tick.evaluatedFor.getTime())).toEqual([noon, noon + minute]);
		expect(ticks.map(tick => [tick.dispatched, tick.skipped])).toEqual([[7, 3], [1, 0]]);
		expect(await QueuedJob.query().count()).toBe(11);
		expect(errors).toHaveLength(1);
	});

	it('reconsiders a minute when its heartbeat fails without queuing duplicate jobs', async () => {
		schedule('noon');
		let calls = 0;
		worker = createWorker({
			onTick: async result => {
				ticks.push(result);
				if (++calls === 1) throw new Error('Heartbeat store unavailable.');
				worker.stop();
			},
			sleep: async delay => { expect(delay).toBe(1000); currentTime += delay; },
		});
		await worker.start();
		expect(ticks.map(tick => [tick.dispatched, tick.skipped])).toEqual([[1, 0], [0, 1]]);
		expect(await QueuedJob.query().count()).toBe(1);
		expect(errors).toHaveLength(1);
	});

	it('records an individual job failure and still evaluates other jobs and the next minute', async () => {
		application.scheduler.job(() => { throw new Error('Invalid job configuration.'); }).name('broken').dailyAt('12:00');
		schedule('other');
		schedule('next', '12:01');
		const saved: number[] = [];
		worker = createWorker({
			checkpoint: {
				async load(firstMinute) { return new Date(firstMinute.getTime() - minute); },
				async save(evaluatedFor) { saved.push(evaluatedFor.getTime()); currentTime += minute; if (saved.length === 2) worker.stop(); },
			},
		});
		await worker.start();
		expect(saved).toEqual([noon, noon + minute]);
		expect(ticks.map(tick => tick.evaluatedFor.getTime())).toEqual([noon + minute]);
		expect(await QueuedJob.query().count()).toBe(2);
		expect(await ScheduledOccurrence.where('name', 'broken').firstOrFail()).toMatchObject({ status: 'failed' });
		expect(errors).toHaveLength(1);
	});

	it('finishes the complete due batch before a graceful stop saves its checkpoint', async () => {
		for (let index = 0; index < 10; index++) schedule(`noon-${index}`);
		let saved: Date | undefined;
		const unsubscribe = application.queue.events.subscribe(async event => { if (event.action === 'dispatched') worker.stop(); });
		worker = createWorker({ checkpoint: {
			async load(firstMinute) { return new Date(firstMinute.getTime() - minute); },
			async save(evaluatedFor) { saved = evaluatedFor; },
		} });
		try { await worker.start(); } finally { unsubscribe(); }
		expect(saved).toEqual(new Date(noon));
		expect(await QueuedJob.query().count()).toBe(10);
	});

	it('passes durable progress and evaluated-minute heartbeats through the console and cleans up shutdown handlers', async () => {
		let initialized: Date | undefined;
		let saved: Date | undefined;
		const sigintListeners = process.listenerCount('SIGINT');
		const sigtermListeners = process.listenerCount('SIGTERM');
		await runSchedulerConsole({
			app: () => application,
			checkpoint: {
				async load(firstMinute) { initialized = firstMinute; return new Date(firstMinute.getTime() - minute); },
				async save(evaluatedFor) { saved = evaluatedFor; },
			},
			onTick: async result => { ticks.push(result); process.emit('SIGTERM'); },
		}, ['scheduler:work']);
		expect(initialized).toBeInstanceOf(Date);
		expect(saved).toEqual(initialized);
		expect(ticks.map(tick => tick.evaluatedFor)).toEqual([initialized]);
		expect(process.listenerCount('SIGINT')).toBe(sigintListeners);
		expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners);
	});
});
