import { describe, expect, it } from 'vitest';
import { QueueWorker, QueueRetryLaterError, runQueueConsole, type Queue } from '@db3.ai/app/queue';

/** Runs the same worker admission and lifecycle expectations against each real driver. */
export function queueSelectionContract(getQueue: () => Queue): void {
	describe('named queue selection', () => {
		it('applies named pool exclusions to one-shot console work and closes the app', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			await queue.dispatch('selection.noop', {}, { queue: 'articles' });
			await queue.dispatch('selection.noop', {}, { queue: 'default' });
			let closed = 0;
			await runQueueConsole({
				app: () => ({ queue, close: () => { closed++; } }),
				workers: { general: { queues: '*', excludeQueues: ['articles'] } },
			}, ['queue:work', '--pool=general', '--once']);
			expect(closed).toBe(1);
			expect(await queue.workNextJob('default')).toBeNull();
			expect((await queue.workNextJob('articles'))?.job.attempts).toBe(1);
		});
		it('preserves queue and attempt accounting across deferral while serving other queues', async () => {
			const queue = getQueue();
			let attempts = 0;
			queue.registerHandler('selection.defer', async () => { if (++attempts === 1) throw new QueueRetryLaterError(0); });
			queue.registerHandler('selection.noop', async () => {});
			await queue.dispatch('selection.defer', {}, { queue: 'articles' });
			await queue.dispatch('selection.noop', {}, { queue: 'default' });
			const worker = new QueueWorker(queue, { queues: ['articles', 'default'] });
			expect(await worker.workOnce()).toMatchObject({ status: 'deferred', job: { queue: 'articles', attempts: 0 } });
			expect(await worker.workOnce()).toMatchObject({ status: 'succeeded', job: { queue: 'default' } });
			expect(await worker.workOnce()).toMatchObject({ status: 'succeeded', job: { queue: 'articles', attempts: 1 } });
		});
		it('rotates after each claim, skips empty queues and deduplicates names', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			for (const name of ['a', 'a', 'b', 'b']) await queue.dispatch('selection.noop', {}, { queue: name });
			const worker = new QueueWorker(queue, { queues: ['empty', 'a', 'a', 'b'] });
			const handled = [];
			for (let index = 0; index < 4; index++) handled.push((await worker.workOnce())?.job.queue);
			expect(handled).toEqual(['a', 'b', 'a', 'b']);
			expect(await worker.workOnce()).toBeNull();
		});

		it('never claims excluded queues and discovers newly introduced queues after idle', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			for (const name of ['articles', 'article-images', 'default']) await queue.dispatch('selection.noop', {}, { queue: name });
			const worker = new QueueWorker(queue, { queues: '*', excludeQueues: ['articles', 'article-images'] });
			expect((await worker.workOnce())?.job.queue).toBe('default');
			expect(await worker.workOnce()).toBeNull();
			await queue.dispatch('selection.noop', {}, { queue: 'new:queue' });
			expect((await worker.workOnce())?.job.queue).toBe('new:queue');
			for (const name of ['articles', 'article-images']) expect((await queue.workNextJob(name))?.job.attempts).toBe(1);
		});

		it('rotates wildcard queues even when the previously selected queue disappears', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			for (const name of ['a', 'b', 'c']) await queue.dispatch('selection.noop', {}, { queue: name });
			const worker = new QueueWorker(queue, { queues: '*' });
			expect((await worker.workOnce())?.job.queue).toBe('a');
			await queue.dispatch('selection.noop', {}, { queue: 'a' });
			expect((await worker.workOnce())?.job.queue).toBe('b');
			expect((await worker.workOnce())?.job.queue).toBe('c');
			expect((await worker.workOnce())?.job.queue).toBe('a');
		});

		it('honours explicit exclusions and keeps delayed work unavailable', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			await queue.dispatch('selection.noop', {}, { queue: 'delayed', delaySeconds: 3600 });
			await queue.dispatch('selection.noop', {}, { queue: 'excluded' });
			await queue.dispatch('selection.noop', {}, { queue: 'ready' });
			const worker = new QueueWorker(queue, { queues: ['delayed', 'excluded', 'ready'], excludeQueues: ['excluded'] });
			expect((await worker.workOnce())?.job.queue).toBe('ready');
			expect(await worker.workOnce()).toBeNull();
			expect(await queue.queueNames()).toEqual(expect.arrayContaining(['delayed', 'excluded']));
			expect((await queue.workNextJob('excluded'))?.job.attempts).toBe(1);
		});

		it('preserves atomic claims when multiple wildcard workers compete', async () => {
			const queue = getQueue();
			queue.registerHandler('selection.noop', async () => {});
			for (let index = 0; index < 8; index++) await queue.dispatch('selection.noop', {}, { queue: index % 2 ? 'a' : 'b' });
			const workers = [new QueueWorker(queue, { queues: '*' }), new QueueWorker(queue, { queues: '*' })];
			const ids = [];
			for (let index = 0; index < 4; index++) {
				const results = await Promise.all(workers.map(worker => worker.workOnce()));
				ids.push(...results.map(result => result?.job.id));
			}
			expect(ids).not.toContain(undefined);
			expect(new Set(ids).size).toBe(8);
		});

		it('drains an active job without claiming more work and refuses concurrent execution', async () => {
			const queue = getQueue();
			let entered!: () => void;
			let release!: () => void;
			const started = new Promise<void>(resolve => { entered = resolve; });
			const finish = new Promise<void>(resolve => { release = resolve; });
			queue.registerHandler('selection.block', async () => { entered(); await finish; });
			await queue.dispatch('selection.block', {}, { queue: 'a' });
			await queue.dispatch('selection.block', {}, { queue: 'b' });
			const worker = queue.startWorker({ queues: '*' }, { force: true, maxJobsPerTick: 5 })!;
			await started;
			try {
				await expect(worker.workOnce()).rejects.toThrow('already processing');
				let drained = false;
				const draining = worker.stopAndDrain().then(() => { drained = true; });
				await Promise.resolve();
				expect(drained).toBe(false);
				release();
				await draining;
				expect(await worker.workOnce()).toBeNull();
				expect((await queue.workNextJob('b'))?.job.attempts).toBe(1);
			} finally {
				release();
				await worker.stopAndDrain();
			}
		});

		it('rejects empty and invalid selections instead of silently broadening admission', () => {
			const queue = getQueue();
			expect(() => new QueueWorker(queue, { queues: [] })).toThrow('at least one');
			expect(() => new QueueWorker(queue, { queues: ['a'], excludeQueues: ['a'] })).toThrow('no eligible');
			expect(() => new QueueWorker(queue, { queues: ['*'] })).toThrow('exact names');
			expect(() => new QueueWorker(queue, { queues: [''] })).toThrow('exact names');
		});
	});
}
