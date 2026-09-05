import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';
import { registerGenerateReportJob } from './createAndProcessReportJob';
import { dispatchReportBatch, dispatchReportPipeline } from './dispatchReportWorkflows';

/**
 * Compares sequential chains with immediately queued batches using real SQL.
 *
 * The example job only logs a report identity. This lab proves orchestration,
 * not a reporting provider. It creates and destroys its own test database.
 *
 * @returns Stable queue counts, validation and processing observations.
 */
export async function runQueueWorkflows() {
	const database = await createGeneratedTestDatabase('queue_workflows');
	const application = new App({ db: database.db, queue: { queue: 'reports', queueMonitor: false } });
	try {
		application.log.level = 'silent';
		await application.db.install(QueuedJob, FailedJob);
		registerGenerateReportJob();
		let invalidRejected = false;
		try { await dispatchReportPipeline([]); } catch (error) { invalidRejected = error instanceof Error && error.message.includes('at least one report'); }
		const afterInvalid = await QueuedJob.query().count();
		await dispatchReportPipeline(['first', 'second']);
		const chainInitial = await QueuedJob.query().count();
		const first = await application.queue.workNextJob('reports');
		const chainRemaining = await QueuedJob.query().count();
		const second = await application.queue.workNextJob('reports');
		const batch = await dispatchReportBatch(['third', 'fourth']);
		const batchInitial = await QueuedJob.query().count();
		const third = await application.queue.workNextJob('reports');
		const fourth = await application.queue.workNextJob('reports');
		return { invalidRejected, afterInvalid, chainInitial, chainRemaining, batchInitial, batchIds: batch.length, statuses: [first?.status, second?.status, third?.status, fourth?.status], remaining: await QueuedJob.query().count() };
	} finally {
		try { await application.close(); } finally { await database.destroy(); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runQueueWorkflows(), null, 2));
}
