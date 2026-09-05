import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence } from '@db3.ai/app/scheduler';
import { App } from '@db3.ai/app/server';
import { RecoverableSummaryJob } from './RecoverableSummaryJob';

/**
 * Recovers a terminal scheduled failure without rewriting its original audit row.
 *
 * The replacement job has a new identity and links to the retained failure.
 * The lab uses immediate retries only to avoid waiting; production workers
 * should use deliberate backoff. All SQL and files belong to this invocation.
 *
 * @returns Original audit state, replacement outcome, linkage and cleaned queue.
 */
export async function runScheduledReplay() {
	const root = await mkdtemp(join(tmpdir(), 'db3-scheduled-replay-'));
	try {
		const database = await createGeneratedTestDatabase('scheduled_replay');
		const application = new App({ db: database.db, queue: { retryDelaySeconds: 0, queueMonitor: false }, storage: { disks: { local: { driver: 'local', root } } } });
		try {
			await application.db.install(QueuedJob, FailedJob, ScheduledOccurrence);
			application.queue.registerJob(RecoverableSummaryJob);
			application.scheduler.job(RecoverableSummaryJob).dailyAt('09:00').timezone('UTC');
			const minute = new Date('2026-01-01T09:00:00Z');
			await application.scheduler.runDue(minute);
			// Default maxTries is three. Bound the drain so a regression cannot hang.
			for (let attempt = 0; attempt < 3; attempt++) await application.queue.workNextJob();
			const original = await ScheduledOccurrence.where('name', RecoverableSummaryJob.jobName).firstOrFail();
			const [failure] = await application.queue.failedJobs();
			if (!failure || original.status !== 'failed') throw new Error('Expected the missing source to reach terminal failure.');
			await application.storage.write('summary-source.txt', 'Recovered');
			const replacementId = await application.queue.retryFailed(failure.id);
			const replacement = await QueuedJob.findOrFail(replacementId);
			const linked = replacement.payload?.retryOf?.failedJobId === failure.id;
			const result = await application.queue.workNextJob();
			const retained = await ScheduledOccurrence.findOrFail(original.id!);
			return {
				originalStatus: retained.status, replacementStatus: result?.status, linked,
				newIdentity: replacement.payload?.uuid !== failure.payload.uuid,
				text: await application.storage.readToString('reports/recovered.txt'),
				duplicateSkipped: (await application.scheduler.runDue(minute)).skipped,
				retainedFailures: (await application.queue.failedJobs()).length,
				activeJobs: await QueuedJob.query().count(),
			};
		} finally {
			try { await application.close(); } finally { await database.destroy(); }
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runScheduledReplay(), null, 2));
}
