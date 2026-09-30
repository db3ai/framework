import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob, QueueWorker } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';

/**
 * Demonstrates protected and shared workers using real durable named queues.
 * Creates a disposable database and closes it even when processing fails.
 * Handlers represent local work only; no external services are contacted.
 */
export async function runQueueSelection() {
	const database = await createGeneratedTestDatabase('queue_selection');
	const application = new App({ db: database.db, queue: { queueMonitor: false } });
	try {
		await application.db.install(QueuedJob, FailedJob);
		const handled: string[] = [];
		application.queue.registerHandler('example.work', async job => { handled.push(job.queue); });
		for (const queue of ['articles', 'article-images', 'default']) {
			await application.queue.dispatch('example.work', {}, { queue });
		}
		const general = new QueueWorker(application.queue, { queues: '*', excludeQueues: ['articles', 'article-images'] });
		const shared = new QueueWorker(application.queue, { queues: '*' });
		await general.workOnce();
		const protectedIdle = await general.workOnce() === null;
		while (await shared.workOnce()) { /* Drain remaining eligible work. */ }
		return { handled, protectedIdle, remaining: await QueuedJob.query().count() };
	} finally {
		try { await application.close(); } finally { await database.destroy(); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runQueueSelection(), null, 2));
}
