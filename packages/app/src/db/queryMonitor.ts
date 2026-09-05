import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';

import {
	createHttpEventDispatcher,
	devtoolsEventsUrl,
	isInteractiveDevelopmentEnvironment,
	type DevtoolsEnvironment,
	type DevtoolsEventDispatcher,
	type HttpEventDispatcherOptions,
} from '../devtools';
import { isDevelopmentEnvironment } from './sqlErrors';

export type QueryMonitorMode = 'dev' | 'slow' | 'full';
export type QueryMonitorStatus = 'ok' | 'error';

export interface QueryMonitorOptions {
	/**
	 * Human-readable source name copied to every emitted query event.
	 */
	source?: string;

	/**
	 * Number of recent completed query events retained in memory.
	 */
	maxEntries?: number;

	/**
	 * Minimum completed query duration required before an event is retained.
	 */
	slowMs?: number;

	/**
	 * Whether query bindings should be copied to emitted events.
	 */
	includeBindings?: boolean;

	/**
	 * Optional event sink that receives every retained query event.
	 */
	dispatch?: QueryMonitorDispatcher;
}

/**
 * HTTP delivery configuration for query monitor events.
 */
export type HttpQueryMonitorDispatcherOptions = HttpEventDispatcherOptions;

export interface QueryMonitorEvent {
	type: 'db.query';
	id: string;
	source: string;
	timestamp: string;
	/** Framework operation category associated with the query, when supplied. */
	category?: string;
	sql: string;
	durationMs: number;
	status: QueryMonitorStatus;
	bindings?: unknown[];
	errorMessage?: string;
	transactionId?: string;
	connectionId?: string;
}

export type QueryMonitorListener = (event: QueryMonitorEvent) => void;
export type QueryMonitorDispatcher = (event: QueryMonitorEvent) => void;

interface StartedQuery {
	id: string;
	source: string;
	category?: string;
	sql: string;
	bindings?: unknown[];
	startedAt: number;
	transactionId?: string;
	connectionId?: string;
}

interface KnexQueryEvent {
	__knexQueryUid?: unknown;
	__knexTxId?: unknown;
	__knexUid?: unknown;
	sql?: unknown;
	bindings?: unknown;
}

interface EventedConnection {
	on(event: string, listener: (...args: any[]) => void): unknown;
	off?(event: string, listener: (...args: any[]) => void): unknown;
	removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

interface QueryMonitorEnvironment extends DevtoolsEnvironment {
	PLATFORM_DEVTOOLS_PORT?: string;
	PLATFORM_QUERY_MONITOR?: string;
	PLATFORM_QUERY_MONITOR_BINDINGS?: string;
	PLATFORM_QUERY_MONITOR_MAX?: string;
	PLATFORM_QUERY_MONITOR_SLOW_MS?: string;
	PLATFORM_QUERY_MONITOR_SOURCE?: string;
	npm_package_name?: string;
}

interface QueryMonitorContext {
	category?: string;
}

const defaultMaxEntries = 500;
const monitors = new WeakMap<Knex, QueryMonitor>();
const queryMonitorContext = new AsyncLocalStorage<QueryMonitorContext>();

/**
 * Runs database work under a framework category copied onto monitored query events.
 *
 * Categories let development tooling separate framework bookkeeping from application
 * queries without parsing SQL or changing how the database operation itself behaves.
 *
 * @param category - Stable framework operation category such as `queue`.
 * @param callback - Database work to execute inside the category context.
 * @returns The callback result without changing its sync or async behavior.
 */
export function withQueryMonitorCategory<TResult>(
	category: string,
	callback: () => TResult,
): TResult {
	return queryMonitorContext.run({
		category,
	}, callback);
}

/**
 * Captures completed Knex query timings from one database connection.
 */
export class QueryMonitor {
	private readonly starts = new Map<string, StartedQuery>();
	private readonly entries: QueryMonitorEvent[] = [];
	private readonly listeners = new Set<QueryMonitorListener>();
	private readonly maxEntries: number;
	private readonly source: string;
	private readonly slowMs: number;
	private readonly includeBindings: boolean;
	private readonly dispatch?: QueryMonitorDispatcher;
	private readonly eventedConnection: EventedConnection;
	private readonly handleQueryBound = this.handleQuery.bind(this);
	private readonly handleQueryResponseBound = this.handleQueryResponse.bind(this);
	private readonly handleQueryErrorBound = this.handleQueryError.bind(this);

	/**
	 * Attaches monitor listeners to a Knex connection.
	 */
	constructor(
		private readonly connection: Knex,
		options: QueryMonitorOptions = {},
	) {
		this.maxEntries = normalizePositiveInteger(options.maxEntries, defaultMaxEntries);
		this.source = options.source || 'app';
		this.slowMs = normalizeNonNegativeNumber(options.slowMs, 0);
		this.includeBindings = options.includeBindings ?? false;
		this.dispatch = options.dispatch;
		this.eventedConnection = connection as unknown as EventedConnection;

		this.eventedConnection.on('query', this.handleQueryBound);
		this.eventedConnection.on('query-response', this.handleQueryResponseBound);
		this.eventedConnection.on('query-error', this.handleQueryErrorBound);
	}

	/**
	 * Returns completed query events retained in memory.
	 */
	recent(): QueryMonitorEvent[] {
		return [...this.entries];
	}

	/**
	 * Removes completed query events from the in-memory buffer.
	 */
	clear(): void {
		this.entries.length = 0;
	}

	/**
	 * Subscribes to completed query events and returns an unsubscribe callback.
	 */
	subscribe(listener: QueryMonitorListener): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Removes Knex event listeners registered by this monitor.
	 */
	destroy(): void {
		removeConnectionListener(this.eventedConnection, 'query', this.handleQueryBound);
		removeConnectionListener(this.eventedConnection, 'query-response', this.handleQueryResponseBound);
		removeConnectionListener(this.eventedConnection, 'query-error', this.handleQueryErrorBound);
		this.listeners.clear();
		this.starts.clear();
	}

	/**
	 * Stores the start metadata needed to calculate query duration.
	 */
	private handleQuery(query: KnexQueryEvent): void {
		const id = queryIdentifier(query);
		const sql = typeof query.sql === 'string' ? query.sql : '';

		this.starts.set(id, {
			id,
			source: this.source,
			category: queryMonitorContext.getStore()?.category,
			sql,
			bindings: this.includeBindings ? normalizeBindings(query.bindings) : undefined,
			startedAt: performance.now(),
			transactionId: stringValue(query.__knexTxId),
			connectionId: stringValue(query.__knexUid),
		});
	}

	/**
	 * Publishes a successful completed query event.
	 */
	private handleQueryResponse(_response: unknown, query: KnexQueryEvent): void {
		this.complete(query, 'ok');
	}

	/**
	 * Publishes a failed completed query event.
	 */
	private handleQueryError(error: unknown, query: KnexQueryEvent): void {
		this.complete(query, 'error', errorMessage(error));
	}

	/**
	 * Converts a Knex completion event into the public monitor event shape.
	 */
	private complete(
		query: KnexQueryEvent,
		status: QueryMonitorStatus,
		errorMessageValue?: string,
	): void {
		const id = queryIdentifier(query);
		const started = this.starts.get(id) ?? fallbackStartedQuery(
			id,
			query,
			this.source,
			this.includeBindings,
		);
		const durationMs = roundDuration(performance.now() - started.startedAt);

		this.starts.delete(id);

		if (durationMs < this.slowMs) return;

		this.record({
			type: 'db.query',
			id,
			source: started.source,
			timestamp: new Date().toISOString(),
			category: started.category,
			sql: started.sql,
			bindings: started.bindings,
			durationMs,
			status,
			errorMessage: errorMessageValue,
			transactionId: started.transactionId,
			connectionId: started.connectionId,
		});
	}

	/**
	 * Retains an event and notifies local plus external subscribers.
	 */
	private record(event: QueryMonitorEvent): void {
		this.entries.push(event);

		while (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}

		for (const listener of this.listeners) {
			listener(event);
		}

		this.dispatch?.(event);
	}
}

/**
 * Returns the existing monitor for a connection or attaches a new one.
 */
export function queryMonitorFor(
	connection: Knex,
	options: QueryMonitorOptions = {},
): QueryMonitor {
	const existing = monitors.get(connection);

	if (existing) return existing;

	const monitor = new QueryMonitor(connection, options);

	monitors.set(connection, monitor);

	return monitor;
}

/**
 * Enables the environment-default query monitor when the runtime opts in.
 */
export function enableDefaultQueryMonitor(
	connection: Knex,
	options: QueryMonitorOptions | false | undefined = undefined,
	env: QueryMonitorEnvironment = process.env,
): QueryMonitor | null {
	if (options === false) return null;

	const defaults = defaultQueryMonitorOptions(env);
	const resolved = defaults || options
		? {
			...(defaults ?? {}),
			...(options ?? {}),
		}
		: null;

	if (!resolved) return null;

	return queryMonitorFor(connection, resolved);
}

/**
 * Resolves query monitor defaults from development and observability env vars.
 */
export function defaultQueryMonitorOptions(
	env: QueryMonitorEnvironment = process.env,
): QueryMonitorOptions | null {
	const mode = queryMonitorMode(env.PLATFORM_QUERY_MONITOR, env.NODE_ENV);

	if (!mode) return null;

	const includeBindings = booleanEnv(
		env.PLATFORM_QUERY_MONITOR_BINDINGS,
		mode === 'full' || (mode === 'dev' && isDevelopmentEnvironment(env.NODE_ENV ?? '')),
	);

	return {
		source: env.PLATFORM_QUERY_MONITOR_SOURCE || env.npm_package_name || 'app',
		maxEntries: parseIntegerEnv(env.PLATFORM_QUERY_MONITOR_MAX, defaultMaxEntries),
		slowMs: mode === 'slow'
			? parseNumberEnv(env.PLATFORM_QUERY_MONITOR_SLOW_MS, 100)
			: parseNumberEnv(env.PLATFORM_QUERY_MONITOR_SLOW_MS, 0),
		includeBindings,
		dispatch: createHttpQueryMonitorDispatcher({
			url: devtoolsEventsUrl(env),
		}),
	};
}

/**
 * Creates a fire-and-forget batched HTTP dispatcher for query events.
 */
export function createHttpQueryMonitorDispatcher(
	options: HttpQueryMonitorDispatcherOptions = {},
): DevtoolsEventDispatcher<QueryMonitorEvent> {
	return createHttpEventDispatcher<QueryMonitorEvent>(options);
}

/**
 * Resolves whether monitoring should be active for the current environment.
 */
function queryMonitorMode(
	input: string | undefined,
	environment: string | undefined,
): QueryMonitorMode | null {
	const normalized = (input || '').toLowerCase().trim();

	switch (normalized) {
		case '':
			return isInteractiveDevelopmentEnvironment(environment) ? 'dev' : null;

		case '1':
		case 'true':
		case 'on':
		case 'dev':
			return 'dev';

		case 'full':
			return 'full';

		case 'slow':
			return 'slow';

		case '0':
		case 'false':
		case 'off':
			return null;

		default:
			return isInteractiveDevelopmentEnvironment(environment) ? 'dev' : null;
	}
}

/**
 * Normalizes Knex query bindings into a JSON-safe array copy.
 */
function normalizeBindings(input: unknown): unknown[] | undefined {
	if (input === undefined) return undefined;
	if (Array.isArray(input)) return [...input];
	return [input];
}

/**
 * Resolves a stable key for correlating Knex query lifecycle events.
 */
function queryIdentifier(query: KnexQueryEvent): string {
	return stringValue(query.__knexQueryUid)
		|| `${stringValue(query.__knexUid) || 'connection'}:${stringValue(query.sql)}`;
}

/**
 * Creates fallback start metadata when Knex reports completion without a start.
 */
function fallbackStartedQuery(
	id: string,
	query: KnexQueryEvent,
	source: string,
	includeBindings: boolean,
): StartedQuery {
	return {
		id,
		source,
		category: queryMonitorContext.getStore()?.category,
		sql: typeof query.sql === 'string' ? query.sql : '',
		bindings: includeBindings ? normalizeBindings(query.bindings) : undefined,
		startedAt: performance.now(),
		transactionId: stringValue(query.__knexTxId),
		connectionId: stringValue(query.__knexUid),
	};
}

/**
 * Converts unknown values into non-empty strings where possible.
 */
function stringValue(input: unknown): string | undefined {
	if (input === undefined || input === null) return undefined;
	const value = String(input);
	return value || undefined;
}

/**
 * Converts an unknown thrown value into a useful event message.
 */
function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error === undefined || error === null) return '';
	return String(error);
}

/**
 * Rounds a duration to one decimal place while keeping tiny timings visible.
 */
function roundDuration(durationMs: number): number {
	if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
	return Math.round(durationMs * 10) / 10;
}

/**
 * Parses a boolean env var while preserving a default value.
 */
function booleanEnv(input: string | undefined, fallback: boolean): boolean {
	if (input === undefined || input === '') return fallback;

	switch (input.toLowerCase().trim()) {
		case '1':
		case 'true':
		case 'yes':
		case 'on':
			return true;

		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false;

		default:
			return fallback;
	}
}

/**
 * Parses an integer env var while enforcing a positive fallback.
 */
function parseIntegerEnv(input: string | undefined, fallback: number): number {
	const parsed = Number(input);

	if (!Number.isFinite(parsed)) return fallback;

	return normalizePositiveInteger(parsed, fallback);
}

/**
 * Parses a number env var while preserving a fallback.
 */
function parseNumberEnv(input: string | undefined, fallback: number): number {
	const parsed = Number(input);

	if (!Number.isFinite(parsed)) return fallback;

	return parsed;
}

/**
 * Returns a positive integer or the supplied fallback.
 */
function normalizePositiveInteger(input: unknown, fallback: number): number {
	const value = Number(input);

	if (!Number.isFinite(value) || value <= 0) return fallback;

	return Math.trunc(value);
}

/**
 * Returns a non-negative number or the supplied fallback.
 */
function normalizeNonNegativeNumber(input: unknown, fallback: number): number {
	const value = Number(input);

	if (!Number.isFinite(value) || value < 0) return fallback;

	return value;
}

/**
 * Removes an event listener from a Knex-like connection object.
 */
function removeConnectionListener(
	connection: EventedConnection,
	event: string,
	listener: (...args: any[]) => void,
): void {
	if (connection.off) {
		connection.off(event, listener);
		return;
	}

	connection.removeListener?.(event, listener);
}
