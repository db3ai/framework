import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence, SchedulerWorker } from '@db3.ai/app/scheduler';
import { App } from '@db3.ai/app/server';
import { WriteDailySummaryJob } from './WriteDailySummaryJob';

/**
 * Demonstrates elapsed-minute scheduling with a real SQL queue and a controlled clock.
 * Crossing the first boundary during a heartbeat, then spending seventy seconds
 * dispatching two jobs, must also cover the following minute. This isolated lab
 * removes its test database and files and makes no external provider calls.
 *
 * @returns Original due minutes and final outcomes after queue processing.
 */
export async function runSchedulerWindow() {
	const root = await mkdtemp(join(tmpdir(), 'db3-scheduler-window-'));
	try {
		const database = await createGeneratedTestDatabase('scheduler_window_guide');
		const application = new App({ db: database.db, storage: { disks: { local: { driver: 'local', root } } } });
		try {
			await application.db.install(QueuedJob, FailedJob, ScheduledOccurrence);
			application.scheduler.job(WriteDailySummaryJob).name('first-summary').dailyAt('09:00');
			application.scheduler.job(WriteDailySummaryJob).name('second-summary').dailyAt('09:00');
			application.scheduler.job(WriteDailySummaryJob).name('next-summary').dailyAt('09:01');
			let clock = Date.parse('2026-01-01T08:59:59.999Z');
			const unsubscribe = application.queue.events.subscribe(async event => {
				if (event.action === 'dispatched') clock += 35_000;
			});
			const worker = new SchedulerWorker(application.scheduler, {
				now: () => new Date(clock),
				onTick: async result => {
					clock += 3;
					if (result.evaluatedFor.getTime() === Date.parse('2026-01-01T09:01:00Z')) worker.stop();
				},
			});
			try { await worker.start(); } finally { worker.stop(); unsubscribe(); }
			while (await application.queue.workNextJob()) { /* Drain this lab's three jobs. */ }
			const occurrences = await ScheduledOccurrence.query().orderBy('scheduledFor').orderBy('name').all();
			return occurrences.map(occurrence => ({ name: occurrence.name, scheduledFor: occurrence.scheduledFor?.toISOString() ?? null, status: occurrence.status }));
		} finally {
			try { await application.close(); } finally { await database.destroy(); }
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runSchedulerWindow(), null, 2));
}
