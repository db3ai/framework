import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueWorkerReporter } from '../QueueWorkerReporter';
import type { QueueWorkerSnapshot } from '../contracts';

afterEach(() => vi.useRealTimers());

describe('worker presence reporting', () => {
	it('heartbeats during a busy job and retains its identity until the worker stops', async () => {
		vi.useFakeTimers();
		const seen: QueueWorkerSnapshot[] = [];
		const reporter = new QueueWorkerReporter({ queues: '*', excludeQueues: ['site-health'] }, async snapshot => { seen.push(snapshot); });
		const presence = reporter.lane();
		presence.start(); await reporter.flush();
		presence.update('busy', 'default', '123'); await reporter.flush();
		const before = seen.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(seen.length).toBeGreaterThan(before);
		expect(seen.at(-1)).toMatchObject({ status: 'busy', busy: 1, slots: 1, currentJobId: '123', currentQueue: 'default', selection: { queues: '*', excludeQueues: ['site-health'] } });
		expect(new Set(seen.map(row => row.id)).size).toBe(1);
		presence.update('stopping'); await reporter.flush();
		expect(seen.at(-1)).toMatchObject({ status: 'stopping', currentJobId: '123' });
		await presence.stop();
		expect(seen.at(-1)?.status).toBe('stopped');
		const stoppedCount = seen.length;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(seen).toHaveLength(stoppedCount);
	});

	it('reports a pool of slots as one row with a busy count, writing only on status changes between heartbeats', async () => {
		vi.useFakeTimers();
		const seen: QueueWorkerSnapshot[] = [];
		const reporter = new QueueWorkerReporter({ queues: ['articles'] }, async snapshot => { seen.push(snapshot); });
		const lanes = Array.from({ length: 24 }, () => reporter.lane());
		for (const lane of lanes) lane.start();
		await reporter.flush();
		const started = seen.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(seen.length - started).toBe(1);
		expect(seen.at(-1)).toMatchObject({ status: 'idle', busy: 0, slots: 24 });
		lanes[0].update('busy', 'articles', '1'); await reporter.flush();
		const busyWrites = seen.length;
		for (let index = 1; index < 5; index++) lanes[index].update('busy', 'articles', String(index + 1));
		await reporter.flush();
		expect(seen.length - busyWrites).toBeLessThanOrEqual(1);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(seen.at(-1)).toMatchObject({ status: 'busy', busy: 5, slots: 24 });
		for (const lane of lanes.slice(0, 23)) await lane.stop();
		expect(seen.at(-1)?.status).not.toBe('stopped');
		await lanes[23].stop();
		expect(seen.at(-1)).toMatchObject({ status: 'stopped', busy: 0 });
		expect(new Set(seen.map(row => row.id)).size).toBe(1);
	});

	it('coalesces slow observations and does not reject when monitoring fails', async () => {
		vi.useFakeTimers();
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const seen: QueueWorkerSnapshot[] = [];
		const reporter = new QueueWorkerReporter({ queues: ['default'] }, async snapshot => { seen.push(snapshot); if (seen.length === 1) await gate; else throw new Error('Monitoring unavailable'); });
		const presence = reporter.lane();
		presence.start();
		for (let index = 0; index < 50; index++) presence.update('busy', 'default', String(index));
		expect(seen).toHaveLength(1);
		release(); await reporter.flush();
		expect(seen).toHaveLength(2);
		expect(seen[1].currentJobId).toBe('49');
		await expect(presence.stop()).resolves.toBeUndefined();
	});
});
