import { afterEach, expect, it, vi } from 'vitest';
import { Cache } from '@db3.ai/app/cache';
import { runNoteCache } from '../../examples/runNoteCache';

afterEach(() => { vi.useRealTimers(); });

it('coalesces reads, invalidates one owner, rejects bad values and recovers failed lookups', async () => {
	expect(await runNoteCache()).toEqual({ concurrent: [{ count: 1 }, { count: 1 }], firstLoads: 1, refreshed: { count: 2 }, otherOwner: { count: 9 }, rejectedUndefined: true, rejectedFactory: true, recovered: 'ready', cleared: true });
});

it('expires values in milliseconds and keeps independent memory stores isolated', async () => {
	vi.useFakeTimers();
	const first = new Cache();
	const second = new Cache();
	try {
		await first.set('same-key', false, { ttl: 100 });
		expect(await first.get('same-key')).toBe(false);
		expect(await second.get('same-key')).toBeUndefined();
		await vi.advanceTimersByTimeAsync(101);
		expect(await first.get('same-key')).toBeUndefined();
		await expect(first.set(' ', 1)).rejects.toThrow('non-empty');
		await first.set('null-value', null);
		expect(await first.get('null-value')).toBeNull();
	} finally {
		await first.close();
		await second.close();
	}
});
