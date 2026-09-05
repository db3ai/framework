import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { createHttpEventDispatcher } from '../index';

interface TestEvent {
	id: string;
}

describe('HttpEventDispatcher', () => {
	it('batches events without blocking the producer', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => new Response(null, {
			status: 202,
		}));
		const dispatch = createHttpEventDispatcher<TestEvent>({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 50,
		});

		dispatch({ id: 'event-1' });
		dispatch({ id: 'event-2' });

		await vi.runAllTimersAsync();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestEvents(fetchMock)).toEqual([
			{ id: 'event-1' },
			{ id: 'event-2' },
		]);

		vi.useRealTimers();
	});

	it('bounds pending telemetry by discarding the oldest event', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => new Response(null, {
			status: 202,
		}));
		const dispatch = createHttpEventDispatcher<TestEvent>({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 10,
			flushIntervalMs: 50,
			maxPendingEvents: 2,
		});

		dispatch({ id: 'event-1' });
		dispatch({ id: 'event-2' });
		dispatch({ id: 'event-3' });

		await vi.advanceTimersByTimeAsync(50);

		expect(requestEvents(fetchMock)).toEqual([
			{ id: 'event-2' },
			{ id: 'event-3' },
		]);

		vi.useRealTimers();
	});

	it('drains all accepted batches during graceful shutdown', async () => {
		const fetchMock = vi.fn(async () => new Response(null, {
			status: 202,
		}));
		const dispatch = createHttpEventDispatcher<TestEvent>({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 60_000,
		});

		dispatch({ id: 'event-1' });
		dispatch({ id: 'event-2' });
		dispatch({ id: 'event-3' });

		await dispatch.close();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls.flatMap(call => {
			return JSON.parse(call[1]?.body as string).events as TestEvent[];
		})).toEqual([
			{ id: 'event-1' },
			{ id: 'event-2' },
			{ id: 'event-3' },
		]);
	});

	it('drops a failed batch without throwing into application work', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('Devtools unavailable');
		});
		const dispatch = createHttpEventDispatcher<TestEvent>({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 1,
		});

		expect(() => dispatch({ id: 'event-1' })).not.toThrow();

		await dispatch.flush();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

/**
 * Reads the first JSON event batch from a fetch mock.
 *
 * @param fetchMock - Mock that captured the dispatcher request.
 * @returns Parsed event batch.
 */
function requestEvents(
	fetchMock: ReturnType<typeof vi.fn>,
): TestEvent[] {
	return JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).events as TestEvent[];
}
