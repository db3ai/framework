import { expect, it } from 'vitest';
import { ActiveRecord } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob, type QueueLifecycleFailure, type QueueLifecycleListener } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';

it.each(['synchronous', 'asynchronous'] as const)('isolates a %s listener failure after durable dispatch and still notifies other listeners', async (mode) => {
	const database = await createGeneratedTestDatabase('queue_events');
	const failures: QueueLifecycleFailure[] = [];
	const application = new App({ db: database.db, queue: { driver: 'database', queueMonitor: false, onLifecycleError: failure => { failures.push(failure); } } });
	try {
		await application.db.install(QueuedJob, FailedJob);
		const error = new Error('Monitoring unavailable.');
		const listener: QueueLifecycleListener = mode === 'synchronous'
			? () => { throw error; }
			: async () => { throw error; };
		const unsubscribeFailure = application.queue.events.subscribe(listener);
		const observed: string[] = [];
		const unsubscribeObserver = application.queue.events.subscribe(event => { observed.push(event.action); });

		const jobId = await application.queue.dispatch('reports.monitoring.v1', { reportId: 'weekly-v1' });
		expect(observed).toEqual(['dispatched']);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({ source: 'listener', event: { action: 'dispatched', jobId }, error });
		expect(await ActiveRecord.withDb(database.db, () => QueuedJob.query().count())).toBe(1);

		unsubscribeFailure();
		unsubscribeObserver();
		await application.queue.dispatch('reports.monitoring.v1', { reportId: 'weekly-v2' });
		expect(observed).toEqual(['dispatched']);
		expect(failures).toHaveLength(1);
		expect(await ActiveRecord.withDb(database.db, () => QueuedJob.query().count())).toBe(2);
	} finally {
		await application.close();
		await database.destroy();
	}
});


it('reports lifecycle handler exceptions through the application logger', async () => {
	const database = await createGeneratedTestDatabase('queue_events_logging');
	const messages: import('@db3.ai/app/mail').ResolvedMailMessage[] = [];
	const { Mail } = await import('@db3.ai/app/mail');
	const mail = new Mail({ transport: { async send(message) {
		messages.push(message);
		return { id: 'test', transport: 'test', accepted: ['operator@example.test'], rejected: [] };
	} } });
	const application = new App({ db: database.db, mail, queue: { queueMonitor: false }, log: { level: 'error', transports: [{ type: 'email', to: 'operator@example.test' }] } });
	try {
		await application.db.install(QueuedJob, FailedJob);
		application.queue.events.subscribe(() => { throw new Error('Article settlement failed'); });
		const id = await application.queue.dispatch('test.job', {});
		await application.log.flush();
		expect(await QueuedJob.find(id)).not.toBeNull();
		expect(messages).toHaveLength(1);
		expect(messages[0].text).toContain('Article settlement failed');
		expect(messages[0].text).toContain('test.job');
	} finally { await application.close(); await database.destroy(); }
});
