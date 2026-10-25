import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cli } from '@db3.ai/app/cli';
import { App } from '@db3.ai/app/server';
import { ActiveRecord, Database } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueueableJob, QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { createQueueCommands } from '@db3.ai/app/queue/commands';

/** Real serializable job with a controllable business-work boundary for drain assertions. */
class CliRecordingJob extends QueueableJob<{ message: string }> {
	static messages: string[] = [];
	static perform?: () => Promise<void>;
	/** Records successful execution only after application work has completed. */
	async handle(): Promise<void> { await CliRecordingJob.perform?.(); CliRecordingJob.messages.push(this.data.message); }
}

/** Records real framework shutdown while the fixture retains its external database connection. */
class CliQueueApp extends App {
	closed = 0;
	/** Releases actual framework resources before recording successful cleanup. */
	override async close(): Promise<void> { await super.close(); this.closed++; }
}

describe('shared queue CLI with SQL', () => {
	let generated: GeneratedTestDatabase;
	let instances: CliQueueApp[] = [];
	beforeAll(async () => {
		generated = await createGeneratedTestDatabase('cli_queue');
		await new Database(generated.db, { reportSchemaDiff: false }).install(QueuedJob, FailedJob);
	});
	beforeEach(async () => {
		instances = []; CliRecordingJob.messages = []; CliRecordingJob.perform = undefined;
		await ActiveRecord.withDb(generated.db, async () => { await QueuedJob.query().forceDelete(); await FailedJob.query().forceDelete(); });
	});
	afterAll(async () => { await generated?.destroy(); });

	/** Supplies real queue services and the same preparation callback to every CLI invocation. */
	function runner(signal?: AbortSignal): Cli {
		return new Cli({
			/** Creates a fresh invocation without starting an HTTP server. */
			createApp() { const instance = new CliQueueApp({ db: generated.db, log: { level: 'silent' }, queue: { queueMonitor: false } }); instances.push(instance); return instance; },
			/** Registers the serializable job before either dispatch or worker execution. */
			prepareApp(application) { application.queue.registerJob(CliRecordingJob); },
			commands: createQueueCommands({ workers: { reports: { queues: ['reports'], intervalMs: 10 } } }),
		}, { signal, write() {}, writeError(message) { throw new Error(message); } });
	}

	/** Typed options and payloads survive actual database transport and alias-based processing. */
	it('dispatches and consumes through queue, closes once, and retains exact literal payloads', async () => {
		expect(await runner().run(['queue:dispatch', 'CliRecordingJob', '{"message":"first=second=third"}', '--queue', 'reports', '--tries=2'])).toBe(0);
		await ActiveRecord.withDb(generated.db, async () => {
			const job = await QueuedJob.query().first();
			expect(job?.queue).toBe('reports');
			expect(job?.payload?.maxTries).toBe(2);
		});
		expect(await runner().run(['queue', '--pool=reports', '--once'])).toBe(0);
		expect(CliRecordingJob.messages).toEqual(['first=second=third']);
		expect(instances.map(instance => instance.closed)).toEqual([1, 1]);
		await ActiveRecord.withDb(generated.db, async () => { expect(await QueuedJob.query().count()).toBe(0); });
	});

	/** Stop prevents another claim and leaves the app active until the in-flight job completes. */
	it('drains an active SQL delivery before closing its app and leaves the next delivery queued', async () => {
		await runner().run(['queue:dispatch', 'CliRecordingJob', '{"message":"active"}', '--queue=reports']);
		await runner().run(['queue:dispatch', 'CliRecordingJob', '{"message":"next"}', '--queue=reports']);
		const entered = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		CliRecordingJob.perform = async () => { entered.resolve(); await finish.promise; };
		const controller = new AbortController();
		const invocation = runner(controller.signal).run(['queue', '--queue=reports', '--interval=10']);
		try {
			await Promise.race([entered.promise, invocation.then(status => { throw new Error(`Worker exited before handling a job: ${status}`); })]);
			controller.abort();
			await Promise.resolve();
			expect(instances.at(-1)?.closed).toBe(0);
		} finally { controller.abort(); finish.resolve(); await invocation; }
		expect(instances.at(-1)?.closed).toBe(1);
		expect(CliRecordingJob.messages).toEqual(['active']);
		await ActiveRecord.withDb(generated.db, async () => { expect(await QueuedJob.query().count()).toBe(1); });
	});
});
