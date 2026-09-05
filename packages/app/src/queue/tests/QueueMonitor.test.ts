import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	createHttpQueueMonitorDispatcher,
	defaultQueueMonitorOptions,
	QueueMonitor,
	type QueueMonitorEvent,
} from '../index';

describe('QueueMonitor', () => {
	it('records queue lifecycle events and respects the retained size', () => {
		const monitor = new QueueMonitor({
			source: 'test',
			maxEntries: 1,
			includePayload: true,
		});
		const events: QueueMonitorEvent[] = [];

		monitor.subscribe(event => {
			events.push(event);
		});
		monitor.recordJob(sampleInput('dispatched'));
		monitor.recordJob(sampleInput('claimed'));

		expect(events).toHaveLength(2);
		expect(monitor.recent()).toEqual([
			expect.objectContaining({
				type: 'queue.job',
				source: 'test',
				action: 'claimed',
				jobName: 'TestJob',
				payloadData: {
					message: 'Hello',
				},
			}),
		]);
	});

	it('defaults to development mode only when the environment is explicit', () => {
		expect(defaultQueueMonitorOptions({
			NODE_ENV: undefined,
		})).toBeNull();
		expect(defaultQueueMonitorOptions({
			NODE_ENV: 'test',
		})).toBeNull();

		expect(defaultQueueMonitorOptions({
			NODE_ENV: 'development',
			npm_package_name: 'scout',
		})).toMatchObject({
			source: 'scout',
			includePayload: true,
		});
	});

	it('can disable payload capture while still emitting queue events', () => {
		const monitor = new QueueMonitor({
			includePayload: false,
		});

		monitor.recordJob(sampleInput('dispatched'));

		expect(monitor.recent()[0]).toMatchObject({
			action: 'dispatched',
			jobName: 'TestJob',
		});
		expect(monitor.recent()[0]?.payloadData).toBeUndefined();
	});

	it('uses stable ids for terminal failure events', () => {
		const monitor = new QueueMonitor({
			source: 'test',
		});

		monitor.recordJob({
			...sampleInput('failed'),
		});

		expect(monitor.recent()[0]).toMatchObject({
			id: 'queue-failed:job-uuid',
		});
	});

	it('batches queue events for the HTTP devtools event sink', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => new Response(null, {
			status: 202,
		}));
		const dispatch = createHttpQueueMonitorDispatcher({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 50,
		});

		dispatch(sampleEvent('event-1'));
		dispatch(sampleEvent('event-2'));

		await vi.runAllTimersAsync();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
			events: [
				{ id: 'event-1' },
				{ id: 'event-2' },
			],
		});

		vi.useRealTimers();
	});

	it('drops failed devtools batches instead of retrying them forever', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => {
			throw new Error('Devtools unavailable');
		});
		const dispatch = createHttpQueueMonitorDispatcher({
			url: 'http://127.0.0.1:9998/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 50,
			retryAfterMs: 1000,
		});

		dispatch(sampleEvent('event-1'));
		dispatch(sampleEvent('event-2'));

		await vi.runAllTimersAsync();
		await vi.advanceTimersByTimeAsync(5000);

		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});
});

/**
 * Creates one queue monitor job event input for tests.
 */
function sampleInput(action: QueueMonitorEvent['action']) {
	return {
		action,
		queue: 'default',
		jobName: 'TestJob',
		jobId: 1,
		jobUuid: 'job-uuid',
		attempts: 1,
		maxTries: 3,
		payloadData: {
			message: 'Hello',
		},
	};
}

/**
 * Creates a complete queue monitor event for dispatcher tests.
 */
function sampleEvent(id: string): QueueMonitorEvent {
	return {
		type: 'queue.job',
		id,
		source: 'test',
		timestamp: '2026-06-27T00:00:00.000Z',
		action: 'dispatched',
		queue: 'default',
		jobName: 'TestJob',
		jobId: 1,
		jobUuid: 'job-uuid',
		maxTries: 3,
	};
}
