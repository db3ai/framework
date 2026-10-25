import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Cli } from '@db3.ai/app/cli';
import { App } from '@db3.ai/app/server';
import { ActiveRecord, Database } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence, SchedulerCheckpointRecord } from '@db3.ai/app/scheduler';
import { createSchedulerCommands } from '@db3.ai/app/scheduler/commands';

/** Real app whose resource lifecycle is observed across finite and worker invocations. */
class CliSchedulerApp extends App {
	closed = 0;
	/** Keeps fixture SQL alive while releasing the invocation's real framework resources. */
	override async close(): Promise<void> { await super.close(); this.closed++; }
}

describe('shared scheduler CLI with SQL', () => {
	let generated: GeneratedTestDatabase;
	let instances: CliSchedulerApp[] = [];
	beforeAll(async () => {
		generated = await createGeneratedTestDatabase('cli_scheduler');
		await new Database(generated.db, { reportSchemaDiff: false }).install(QueuedJob, FailedJob, ScheduledOccurrence, SchedulerCheckpointRecord);
	});
	beforeEach(async () => {
		instances = [];
		await ActiveRecord.withDb(generated.db, async () => { await ScheduledOccurrence.query().forceDelete(); await SchedulerCheckpointRecord.query().forceDelete(); });
	});
	afterAll(async () => { await generated?.destroy(); });

	/** Uses real schedule definitions and durable progress; only the test's inline application callback is empty. */
	function runner(controller?: AbortController): Cli {
		return new Cli({
			/** Creates an invocation's runtime with the disposable database. */
			createApp() { const instance = new CliSchedulerApp({ db: generated.db, log: { level: 'silent' } }); instances.push(instance); return instance; },
			/** Declares an ordinary scheduled call without executing it at import/startup time. */
			prepareApp(application) { application.scheduler.call(async () => {}).name('cli-maintenance').everyMinute(); },
			commands: createSchedulerCommands({ checkpoint: SchedulerCheckpointRecord.checkpoint('cli-worker'), onTick: () => { controller?.abort(); } }),
		}, { signal: controller?.signal, write() {}, writeError(message) { throw new Error(message); } });
	}

	/** List, evaluation and history stay finite and do not initialize a worker checkpoint. */
	it('runs/list/history share actual definitions and leave durable worker progress untouched', async () => {
		expect(await runner().run(['scheduler:list'])).toBe(0);
		expect(await runner().run(['scheduler:run'])).toBe(0);
		expect(await runner().run(['scheduler:history', '--limit', '1', '--status=succeeded'])).toBe(0);
		await ActiveRecord.withDb(generated.db, async () => {
			expect(await ScheduledOccurrence.query().count()).toBe(1);
			expect(await SchedulerCheckpointRecord.query().count()).toBe(0);
		});
		expect(instances.map(instance => instance.closed)).toEqual([1, 1, 1]);
	});

	/** The alias awaits the actual worker, preserves its checkpoint identity and closes only after the tick. */
	it('scheduler starts the worker, finishes the active tick, saves progress and closes exactly once', async () => {
		const controller = new AbortController();
		try { expect(await runner(controller).run(['scheduler'])).toBe(0); }
		finally { controller.abort(); }
		await ActiveRecord.withDb(generated.db, async () => {
			const record = await SchedulerCheckpointRecord.where('name', 'cli-worker').first();
			const occurrence = await ScheduledOccurrence.query().first();
			expect(record?.value?.evaluatedFor).toBe(occurrence?.scheduledFor?.toISOString());
			expect(occurrence?.status).toBe('succeeded');
		});
		expect(instances[0]?.closed).toBe(1);
	});
});
