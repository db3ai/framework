import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';
import { DeferredReportJob } from './DeferredReportJob';

/** Exercises SQL-backed deferral, unchanged attempts, readiness recovery and a hard deadline. */
export async function runBackpressure() {
	const database = await createGeneratedTestDatabase('backpressure_guide');
	const reportProvider = { ready: false };
	const application = new App({ db: database.db, config: { reportProvider }, queue: { queue: 'reports', queueMonitor: false } });
	try {
		await application.db.install(QueuedJob, FailedJob);
		application.queue.registerJob(DeferredReportJob);
		const id = await application.queue.dispatch(new DeferredReportJob({ deadline: Date.now() + 60_000 }), { queue: 'reports', maxTries: 1 });
		const first = await application.queue.workNextJob('reports');
		const second = await application.queue.workNextJob('reports');
		const deferred = await QueuedJob.findOrFail(id);
		reportProvider.ready = true;
		const recovered = await application.queue.workNextJob('reports');
		await application.queue.dispatch(new DeferredReportJob({ deadline: 1 }), { queue: 'reports', maxTries: 1 });
		const expired = await application.queue.workNextJob('reports');
		return { first: first?.status, second: second?.status, attemptsAfterDeferral: deferred.attempts, recovered: recovered?.status, expired: expired?.status, remainingJobs: await QueuedJob.query().count(), failures: (await application.queue.failedJobs(10)).length };
	} finally { try { await application.close(); } finally { await database.destroy(); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runBackpressure(), null, 2));
