import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueWorkerReporter } from '../QueueWorkerReporter';
import type { QueueWorkerSnapshot } from '../contracts';

afterEach(() => vi.useRealTimers());

describe('worker presence reporting', () => {
	it('heartbeats during a busy job and retains its identity until the worker stops', async () => {
		vi.useFakeTimers();
		const seen: QueueWorkerSnapshot[] = [];
		const reporter = new QueueWorkerReporter({ queues: '*', excludeQueues: ['site-health'] }, async snapshot => { seen.push(snapshot); });
		reporter.start(); await reporter.flush();
		reporter.update('busy', 'default', '123'); await reporter.flush();
		const before = seen.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(seen.length).toBeGreaterThan(before);
		expect(seen.at(-1)).toMatchObject({ status: 'busy', currentJobId: '123', currentQueue: 'default', selection: { queues: '*', excludeQueues: ['site-health'] } });
		expect(new Set(seen.map(row => row.id)).size).toBe(1);
		reporter.update('stopping'); await reporter.flush();
		expect(seen.at(-1)).toMatchObject({ status: 'stopping', currentJobId: '123' });
		await reporter.stop();
		expect(seen.at(-1)?.status).toBe('stopped');
		const stoppedCount = seen.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(seen).toHaveLength(stoppedCount);
	});

	it('coalesces slow observations and does not reject when monitoring fails', async () => {
		vi.useFakeTimers();
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const seen: QueueWorkerSnapshot[] = [];
		const reporter = new QueueWorkerReporter({ queues: ['default'] }, async snapshot => { seen.push(snapshot); if (seen.length === 1) await gate; else throw new Error('Monitoring unavailable'); });
		reporter.start();
		for (let index = 0; index < 50; index++) reporter.update('busy', 'default', String(index));
		expect(seen).toHaveLength(1);
		release(); await reporter.flush();
		expect(seen).toHaveLength(2);
		expect(seen[1].currentJobId).toBe('49');
		await expect(reporter.stop()).resolves.toBeUndefined();
	});
});
