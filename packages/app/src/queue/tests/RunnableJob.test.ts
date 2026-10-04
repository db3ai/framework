import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../../server/App';
import { createGeneratedTestDatabase } from '../../db/test/db';
import { FailedJob, JobRunAttempt, JobRunEvent, QueueRetryLaterError, QueueTerminalError, QueuedJob, RunnableJob, QueueableJob, type QueueableJobContext } from '../index';

/** Exercises persisted state without external effects; each mode tests a worker transition. */
class ProgressJob extends RunnableJob {
	/** Saves concurrent progress then applies the requested deterministic failure policy. */
	override async handle(): Promise<void> {
		await Promise.all(Array.from({ length: 4 }, () => this.checkpoint(run => { run.completed = (run.completed ?? 0) + 1; run.state = { saved: run.completed }; })));
		if (this.input?.mode === 'terminal') throw new QueueTerminalError('Provider balance exhausted.');
		if (this.input?.mode === 'retry' && this.attemptCount === 1) throw new Error('Temporary failure.');
		if (this.input?.mode === 'defer' && this.attemptCount === 1) throw new QueueRetryLaterError(0, 'Provider unavailable.');
		if (this.input?.mode === 'cancel') {
			await RunnableJob.where('id', this.id).patch({ cancelRequestedAt: new Date() });
			await this.assertActive();
		}
		if (this.input?.mode === 'stale') {
			await RunnableJob.where('id', this.id).patch({ leaseToken: 'replaced' });
			await this.checkpoint(run => { run.completed = 999; });
		}
		await this.log('Work saved', { completed: this.completed });
	}
}

/** Represents a framework producer replaced by the application's retained implementation. */
class LegacyProgressJob extends QueueableJob {
	static jobName = 'ProgressJob';
	/** Must never execute after a retained implementation has been registered. */
	async handle(): Promise<void> { throw new Error('Wrong implementation'); }
}

/** Proves nested dispatch inherits only the active asynchronous parent. */
class DispatchChildJob extends RunnableJob {
	/** Enqueues a separate retained child while this attempt owns the parent. */
	async handle(context: QueueableJobContext): Promise<void> {
		await context.queue.dispatch(ProgressJob.create({ tenantId: this.tenantId, input: {} }));
	}
}

describe('RunnableJob database lifecycle', () => {
	let database: Awaited<ReturnType<typeof createGeneratedTestDatabase>>;
	let application: App;
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('runnable_jobs');
		application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false }, queue: { queue: 'runs', queueMonitor: false } });
		await application.db.install(RunnableJob, JobRunAttempt, JobRunEvent, QueuedJob, FailedJob);
	});
	afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); } });

	it('saves before delivery, serializes only its identity and retains completed history', async () => {
		const run = ProgressJob.create({ tenantId: 'tenant-one', input: {}, total: 4 });
		const id = await application.queue.dispatch(run);
		expect((await RunnableJob.findOrFail(run.id!)).status).toBe('waiting');
		expect((await QueuedJob.findOrFail(id)).payload?.data).toEqual({ runId: run.id, deliveryKey: run.deliveryKey });
		expect((await application.queue.workNextJob('runs'))?.status).toBe('succeeded');
		const saved = await RunnableJob.findOrFail(run.id!);
		expect(saved).toMatchObject({ status: 'completed', completed: 4, state: { saved: 4 }, attemptCount: 1 });
		expect(saved.startedAt).toBeInstanceOf(Date);
		expect(saved.completedAt).toBeInstanceOf(Date);
		expect(await QueuedJob.find(id)).toBeNull();
		expect(await JobRunEvent.where('runId', run.id).count()).toBe(3);
	});

	it('retains terminal failure in the run without growing failed delivery storage', async () => {
		const run = ProgressJob.create({ tenantId: 'tenant-two', input: { mode: 'terminal' } });
		await application.queue.dispatch(run);
		expect((await application.queue.workNextJob('runs'))?.status).toBe('failed');
		expect(await RunnableJob.findOrFail(run.id!)).toMatchObject({ status: 'failed', completed: 4, error: 'Provider balance exhausted.' });
		expect(await FailedJob.query().count()).toBe(0);
	});

	it('rehydrates the checkpoint and appends attempts on retry', async () => {
		const run = ProgressJob.create({ tenantId: 'tenant-one', input: { mode: 'retry' } });
		await application.queue.dispatch(run, { backoff: { initialSeconds: 0, maxSeconds: 0, jitter: false }, maxTries: 2 });
		await application.queue.workNextJob('runs');
		expect((await RunnableJob.findOrFail(run.id!)).status).toBe('waiting');
		await application.queue.workNextJob('runs');
		expect(await RunnableJob.findOrFail(run.id!)).toMatchObject({ status: 'completed', completed: 8, attemptCount: 2 });
		expect((await JobRunAttempt.where('runId', run.id).orderBy('attempt').all()).map(attempt => attempt.status)).toEqual(['retrying', 'completed']);
	});

	it('records recovery of an interrupted attempt and refuses duplicate dispatch', async () => {
		const run = ProgressJob.create({ tenantId: 'tenant-one', input: {} });
		await run.save();
		const otherCopy = await ProgressJob.findOrFail(run.id!);
		await application.queue.dispatch(run);
		await expect(application.queue.dispatch(otherCopy)).rejects.toThrow('already been dispatched');
		expect((await RunnableJob.findOrFail(run.id!)).status).toBe('waiting');
		await RunnableJob.where('id', run.id).patch({ status: 'running', attemptCount: 1, completed: 3, leaseToken: 'old-attempt' });
		await JobRunAttempt.create({ runId: run.id, tenantId: run.tenantId, attempt: 1, deliveryId: 'old-delivery', status: 'running', startedAt: new Date() }).save();
		await application.queue.workNextJob('runs');
		expect(await RunnableJob.findOrFail(run.id!)).toMatchObject({ status: 'completed', completed: 7, attemptCount: 2 });
		expect((await JobRunAttempt.where('runId', run.id).orderBy('attempt').all()).map(attempt => attempt.status)).toEqual(['interrupted', 'completed']);
	});

	it('honours cancellation and fences a stale progress writer', async () => {
		const cancelled = ProgressJob.create({ tenantId: 'tenant-one', input: { mode: 'cancel' } });
		await application.queue.dispatch(cancelled);
		await application.queue.workNextJob('runs');
		expect((await RunnableJob.findOrFail(cancelled.id!)).status).toBe('cancelled');
		const stale = ProgressJob.create({ tenantId: 'tenant-one', input: { mode: 'stale' } });
		await application.queue.dispatch(stale, { maxTries: 1 });
		await application.queue.workNextJob('runs');
		expect((await RunnableJob.findOrFail(stale.id!)).completed).toBe(4);
	});
	it('retains named dispatch and framework producers through the registered implementation', async () => {
		application.queue.registerJob(ProgressJob);
		const named = await application.queue.dispatch('ProgressJob', { tenantId: 'named-tenant', input: {} });
		const replaced = await application.queue.dispatch(new LegacyProgressJob({ tenantId: 'named-tenant', input: {} }));
		for (const id of [named, replaced]) {
			const queued = await QueuedJob.findOrFail(id);
			expect(Object.keys(queued.payload!.data).sort()).toEqual(['deliveryKey', 'runId']);
			expect(await RunnableJob.find(queued.payload!.data.runId as string)).toMatchObject({ status: 'waiting', tenantId: 'named-tenant' });
			expect(await application.queue.workNextJob('runs')).toMatchObject({ status: 'succeeded' });
		}
	});

	it('correlates child deliveries without leaking parent context into later dispatches', async () => {
		const parent = DispatchChildJob.create({ tenantId: 'parent-tenant', input: {} });
		await application.queue.dispatch(parent);
		expect(await application.queue.workNextJob('runs')).toMatchObject({ status: 'succeeded' });
		const child = await RunnableJob.where('parentRunId', parent.id).firstOrFail();
		expect(child.status).toBe('waiting');
		expect(await application.queue.workNextJob('runs')).toMatchObject({ status: 'succeeded' });
		expect(RunnableJob.current()).toBeUndefined();
		const separate = ProgressJob.create({ tenantId: 'other-tenant', input: {} });
		await application.queue.dispatch(separate);
		expect(separate.parentRunId).toBeNull();
		await application.queue.workNextJob('runs');
	});

	it('cancels a queued child before work when its ancestor has been cancelled', async () => {
		const parent = DispatchChildJob.create({ tenantId: 'parent-tenant', input: {} });
		await application.queue.dispatch(parent);
		await application.queue.workNextJob('runs');
		const child = await RunnableJob.where('parentRunId', parent.id).firstOrFail();
		await RunnableJob.where('id', parent.id).patch({ cancelRequestedAt: new Date() });
		await application.queue.workNextJob('runs');
		expect(await RunnableJob.findOrFail(child.id!)).toMatchObject({ status: 'cancelled', completed: 0 });
		expect((await JobRunAttempt.where('runId', child.id).firstOrFail()).status).toBe('cancelled');
	});

});
