import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueuedJob, QueueableJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence, SchedulerWorker, SchedulerCheckpointRecord } from '@db3.ai/app/scheduler';
import { App } from '@db3.ai/app/server';
const schedulerCheckpoint = SchedulerCheckpointRecord.checkpoint('scout');

/** SQL-backed job for verifying Scout's durable cursor against the real worker. */
class RestartJob extends QueueableJob {
	/** Initializes its empty serialized payload. */
	constructor() { super({}); }
	/** Completes without external effects. */
	async handle(): Promise<void> {}
}

let database: GeneratedTestDatabase;
let application: App;
const noon = new Date('2026-09-24T12:00:00Z');
const nextMinute = new Date('2026-09-24T12:01:00Z');

describe('Database scheduler checkpoint', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('scheduler_checkpoint');
		application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false } });
		await application.db.install(SchedulerCheckpointRecord, ScheduledOccurrence, QueuedJob);
	});
	beforeEach(async () => {
		await SchedulerCheckpointRecord.query().forceDelete();
		await ScheduledOccurrence.query().forceDelete();
		await QueuedJob.query().forceDelete();
	});
	afterAll(async () => { await application?.close(); await database?.destroy(); });

	it('establishes coverage before work and never mistakes an old heartbeat for progress', async () => {
		await SchedulerCheckpointRecord.create({ name: 'another-scheduler', value: { evaluatedFor: noon.toISOString() } }).save();
		expect(await schedulerCheckpoint.load(noon)).toEqual(new Date('2026-09-24T11:59:00Z'));
		expect(await schedulerCheckpoint.load(nextMinute)).toEqual(new Date('2026-09-24T11:59:00Z'));
		expect(await SchedulerCheckpointRecord.query().count()).toBe(2);
	});

	it('initializes concurrent workers once and keeps saves monotonic', async () => {
		const boundaries = await Promise.all([schedulerCheckpoint.load(noon), schedulerCheckpoint.load(noon)]);
		expect(boundaries[0]).toEqual(boundaries[1]);
		await Promise.all([schedulerCheckpoint.save(nextMinute), schedulerCheckpoint.save(noon)]);
		await schedulerCheckpoint.save(noon);
		expect(await schedulerCheckpoint.load(nextMinute)).toEqual(nextMinute);
		expect(await SchedulerCheckpointRecord.query().count()).toBe(1);
	});

	it('resumes a replacement worker through every minute elapsed since shutdown', async () => {
		application.scheduler.job(RestartJob).name('restart-noon').dailyAt('12:00');
		application.scheduler.job(RestartJob).name('restart-next').dailyAt('12:01');
		application.scheduler.job(RestartJob).name('restart-later').dailyAt('12:03');
		const first = new SchedulerWorker(application.scheduler, { checkpoint: schedulerCheckpoint, now: () => noon, onTick: async () => { first.stop(); } });
		await first.start();
		expect(await schedulerCheckpoint.load(noon)).toEqual(noon);
		const evaluated: string[] = [];
		const replacement = new SchedulerWorker(application.scheduler, {
			checkpoint: schedulerCheckpoint,
			now: () => new Date('2026-09-24T12:03:30Z'),
			onTick: async result => { evaluated.push(result.evaluatedFor.toISOString()); if (evaluated.length === 3) replacement.stop(); },
		});
		await replacement.start();
		expect(evaluated).toEqual(['2026-09-24T12:01:00.000Z', '2026-09-24T12:02:00.000Z', '2026-09-24T12:03:00.000Z']);
		expect(await QueuedJob.query().count()).toBe(3);
		expect(await ScheduledOccurrence.query().count()).toBe(3);
		expect(await schedulerCheckpoint.load(noon)).toEqual(new Date('2026-09-24T12:03:00Z'));
	});

	it('retains the first coverage boundary if a process exits before completing its first minute', async () => {
		await schedulerCheckpoint.load(noon);
		expect(await schedulerCheckpoint.load(new Date('2026-09-25T12:00:00Z'))).toEqual(new Date('2026-09-24T11:59:00Z'));
	});

	it.each(['invalid', '2026-09-24T12:00:00.001Z', undefined])('rejects corrupt progress instead of discarding its window: %s', async value => {
		await database.db(SchedulerCheckpointRecord.table).insert({ id: '01K23456789ABCDEFGHJKMNPAG', name: 'scout', value: JSON.stringify({ evaluatedFor: value }) });
		await expect(schedulerCheckpoint.load(noon)).rejects.toThrow('valid UTC minute');
		await expect(schedulerCheckpoint.save(noon)).rejects.toThrow('valid UTC minute');
	});

	it('refuses to advance progress before establishing the start of coverage', async () => {
		await expect(schedulerCheckpoint.save(noon)).rejects.toThrow('initialized');
	});
});
