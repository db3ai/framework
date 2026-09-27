import { EventEmitter } from 'node:events';
import type { Knex } from 'knex';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	createHttpQueryMonitorDispatcher,
	defaultQueryMonitorOptions,
	enableDefaultQueryMonitor,
	QueryMonitor,
	queryMonitorFor,
	withQueryMonitorCategory,
	type QueryMonitorEvent,
} from '../queryMonitor';

interface QueryEventInput {
	id?: string;
	sql?: string;
	bindings?: unknown[];
	connectionId?: string;
	transactionId?: string;
}

/**
 * Creates an EventEmitter that is close enough to Knex for monitor tests.
 */
function createConnection(): Knex {
	return new EventEmitter() as unknown as Knex;
}

/**
 * Emits a successful query lifecycle through a fake Knex connection.
 */
function emitSuccessfulQuery(
	connection: Knex,
	input: QueryEventInput = {},
): void {
	const event = queryEvent(input);
	const emitter = connection as unknown as EventEmitter;

	emitter.emit('query', event);
	emitter.emit('query-response', [], event);
}

/**
 * Emits a failed query lifecycle through a fake Knex connection.
 */
function emitFailedQuery(
	connection: Knex,
	error: unknown,
	input: QueryEventInput = {},
): void {
	const event = queryEvent(input);
	const emitter = connection as unknown as EventEmitter;

	emitter.emit('query', event);
	emitter.emit('query-error', error, event);
}

/**
 * Builds the Knex event payload shape consumed by the query monitor.
 */
function queryEvent(input: QueryEventInput = {}) {
	return {
		__knexQueryUid: input.id ?? 'query-1',
		__knexUid: input.connectionId ?? 'connection-1',
		__knexTxId: input.transactionId,
		sql: input.sql ?? 'select * from websites where id = ?',
		bindings: input.bindings ?? ['site-1'],
	};
}

describe('QueryMonitor', () => {
	it('records completed query timing, SQL, status, and bindings when enabled', () => {
		const connection = createConnection();
		const monitor = new QueryMonitor(connection, {
			source: 'test',
			includeBindings: true,
		});
		const events: QueryMonitorEvent[] = [];

		monitor.subscribe(event => {
			events.push(event);
		});

		emitSuccessfulQuery(connection);

		expect(monitor.recent()).toHaveLength(1);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: 'db.query',
			id: 'query-1',
			source: 'test',
			sql: 'select * from websites where id = ?',
			bindings: ['site-1'],
			status: 'ok',
			connectionId: 'connection-1',
		});
		expect(events[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('records failed query events with error messages', () => {
		const connection = createConnection();
		const monitor = new QueryMonitor(connection, {
			source: 'test',
		});

		emitFailedQuery(connection, new Error('Duplicate entry'), {
			id: 'query-2',
			sql: 'insert into users (email) values (?)',
		});

		expect(monitor.recent()).toEqual([
			expect.objectContaining({
				id: 'query-2',
				sql: 'insert into users (email) values (?)',
				status: 'error',
				errorMessage: 'Duplicate entry',
			}),
		]);
	});

	it('copies async framework categories onto completed query events', async () => {
		const connection = createConnection();
		const monitor = new QueryMonitor(connection);

		await withQueryMonitorCategory('queue', async () => {
			await Promise.resolve();
			emitSuccessfulQuery(connection, {
				id: 'queue-query',
				sql: 'select * from jobs',
			});
		});

		expect(monitor.recent()).toEqual([
			expect.objectContaining({
				id: 'queue-query',
				category: 'queue',
			}),
		]);
	});

	it('retains only the configured number of recent events', () => {
		const connection = createConnection();
		const monitor = new QueryMonitor(connection, {
			maxEntries: 2,
		});

		emitSuccessfulQuery(connection, { id: 'query-1' });
		emitSuccessfulQuery(connection, { id: 'query-2' });
		emitSuccessfulQuery(connection, { id: 'query-3' });

		expect(monitor.recent().map(event => event.id)).toEqual([
			'query-2',
			'query-3',
		]);
	});

	it('reuses one monitor per connection', () => {
		const connection = createConnection();
		const first = queryMonitorFor(connection, {
			source: 'first',
		});
		const second = queryMonitorFor(connection, {
			source: 'second',
		});

		expect(second).toBe(first);
	});

	it('defaults to development mode only when the environment is explicit', () => {
		expect(defaultQueryMonitorOptions({
			NODE_ENV: undefined,
		})).toBeNull();
		expect(defaultQueryMonitorOptions({
			NODE_ENV: 'test',
		})).toBeNull();

		expect(defaultQueryMonitorOptions({
			NODE_ENV: 'development',
			npm_package_name: 'example-app',
		})).toMatchObject({
			source: 'example-app',
			includeBindings: true,
			slowMs: 0,
		});
	});

	it('allows production slow-query monitoring by explicit override', () => {
		expect(defaultQueryMonitorOptions({
			NODE_ENV: 'production',
			PLATFORM_QUERY_MONITOR: 'slow',
			PLATFORM_QUERY_MONITOR_SLOW_MS: '250',
		})).toMatchObject({
			includeBindings: false,
			slowMs: 250,
		});
	});

	it('can be disabled per Database connection option', () => {
		const connection = createConnection();
		const monitor = enableDefaultQueryMonitor(connection, false, {
			NODE_ENV: 'development',
		});

		expect(monitor).toBeNull();
	});

	it('batches query events for the HTTP devtools event sink', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => new Response(null, {
			status: 202,
		}));
		const dispatch = createHttpQueryMonitorDispatcher({
			url: 'http://127.0.0.1:9999/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 50,
		});

		dispatch(sampleEvent('query-1'));
		dispatch(sampleEvent('query-2'));

		await vi.runAllTimersAsync();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
			events: [
				{ id: 'query-1' },
				{ id: 'query-2' },
			],
		});

		vi.useRealTimers();
	});

	it('drops failed devtools batches instead of retrying them forever', async () => {
		vi.useFakeTimers();

		const fetchMock = vi.fn(async () => {
			throw new Error('Devtools unavailable');
		});
		const dispatch = createHttpQueryMonitorDispatcher({
			url: 'http://127.0.0.1:9999/api/events',
			fetch: fetchMock,
			batchSize: 2,
			flushIntervalMs: 50,
			retryAfterMs: 1000,
		});

		dispatch(sampleEvent('query-1'));
		dispatch(sampleEvent('query-2'));

		await vi.runAllTimersAsync();
		await vi.advanceTimersByTimeAsync(5000);

		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});
});

/**
 * Creates a complete query monitor event for dispatcher tests.
 */
function sampleEvent(id: string): QueryMonitorEvent {
	return {
		type: 'db.query',
		id,
		source: 'test',
		timestamp: '2026-06-25T00:00:00.000Z',
		sql: 'select 1',
		durationMs: 1,
		status: 'ok',
	};
}
