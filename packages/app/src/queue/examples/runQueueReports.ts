import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';
import { WriteReportJob } from './WriteReportJob';

/**
 * Runs durable dispatch, failure repair, replay and duplicate-safe output on SQL.
 *
 * The producer is closed before a fresh worker App restores persisted work.
 * Only this disposable lab uses Database.install(); deployed apps use migrations.
 * A zero retry delay keeps the failure demonstration deterministic without sleeps.
 *
 * @returns Stable observations also asserted by the shipped documentation test.
 */
export async function runQueueReports() {
	const root = await mkdtemp(join(tmpdir(), 'db3-queue-guide-'));
	try {
		const database = await createGeneratedTestDatabase('queue_guide');
		try {
			const producer = new App({ db: database.db, queue: { driver: 'database', queue: 'reports', queueMonitor: false } });
			try {
				await producer.db.install(QueuedJob, FailedJob);
				await producer.queue.dispatch(new WriteReportJob({ reportId: 'weekly-v1' }), {
					maxTries: 2, backoff: { strategy: 'linear', initialSeconds: 0, maxSeconds: 0, jitter: false },
				});
			} finally {
				await producer.close();
			}

			const consumer = new App({
				db: database.db,
				queue: { driver: 'database', queue: 'reports', queueMonitor: false },
				storage: { disks: { local: { driver: 'local', root } } },
			});
			try {
				consumer.queue.registerJob(WriteReportJob);
				const wrongQueueIdle = await consumer.queue.workNextJob('default') === null;
				const firstAttempt = await consumer.queue.workNextJob('reports');
				const finalAttempt = await consumer.queue.workNextJob('reports');
				const [failed] = await consumer.queue.failedJobs(10);
				if (!failed) throw new Error('Expected the missing source to produce a persisted terminal failure.');

				// Repair the cause before replaying. No queued payload or audit row is edited.
				await consumer.storage.write('sources/weekly-v1.txt', 'Three notes ready');
				const replacementId = await consumer.queue.retryFailed(failed.id);
				const replacement = await QueuedJob.findOrFail(replacementId);
				const replayLinked = replacement.payload?.retryOf?.failedJobId === failed.id;
				const worker = consumer.queue.startWorker('reports', { force: true, maxJobsPerTick: 1 });
				if (!worker) throw new Error('The report worker did not start.');
				await worker.stopAndDrain();

				await consumer.queue.dispatch(new WriteReportJob({ reportId: 'weekly-v1' }));
				const repeated = await consumer.queue.workNextJob('reports');
				const files = [];
				for await (const file of consumer.storage.list('reports')) files.push(file);
				return {
					wrongQueueIdle, firstAttempt: firstAttempt?.status, finalAttempt: finalAttempt?.status,
					replayLinked, repeated: repeated?.status,
					text: await consumer.storage.readToString('reports/weekly-v1.txt'),
					reportFiles: files.length, remainingJobs: await QueuedJob.query().count(),
					retainedFailures: (await consumer.queue.failedJobs(10)).length,
				};
			} finally {
				await consumer.close();
			}
		} finally {
			await database.destroy();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runQueueReports(), null, 2));
}
