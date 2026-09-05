import { randomUUID } from 'node:crypto';

import {
	createHttpEventDispatcher,
	devtoolsEventsUrl,
	isInteractiveDevelopmentEnvironment,
	type DevtoolsEnvironment,
	type DevtoolsEventDispatcher,
	type HttpEventDispatcherOptions,
} from '../devtools';
import { isDevelopmentEnvironment } from '../db/sqlErrors';
import type * as queue from './contracts';

export type QueueMonitorMode = 'dev' | 'full';
export type QueueMonitorAction = queue.QueueLifecycleAction;

export interface QueueMonitorOptions {
	/**
	 * Human-readable source name copied to every emitted queue event.
	 */
	source?: string;

	/**
	 * Number of recent queue events retained in memory.
	 */
	maxEntries?: number;

	/**
	 * Whether queued payload data should be copied into emitted events.
	 */
	includePayload?: boolean;

	/**
	 * Optional event sink that receives every retained queue event.
	 */
	dispatch?: QueueMonitorDispatcher;
}

/**
 * HTTP delivery configuration for queue monitor events.
 */
export type HttpQueueMonitorDispatcherOptions = HttpEventDispatcherOptions;

export interface QueueMonitorEvent {
	type: 'queue.job';
	id: string;
	source: string;
	timestamp: string;
	action: QueueMonitorAction;
	queue: string;
	jobName: string;
	jobId?: queue.QueueJobId;
	jobUuid?: string;
	attempts?: number;
	maxTries?: number;
	delaySeconds?: number;
	durationMs?: number;
	errorMessage?: string;
	origin?: queue.QueueJobOrigin;
	payloadData?: Record<string, unknown>;
}

export interface QueueMonitorJobEventInput {
	timestamp?: string;
	action: QueueMonitorAction;
	queue: string;
	jobName: string;
	jobId?: queue.QueueJobId;
	jobUuid?: string;
	attempts?: number;
	maxTries?: number;
	delaySeconds?: number;
	durationMs?: number;
	error?: unknown;
	origin?: queue.QueueJobOrigin;
	payloadData?: Record<string, unknown>;
}

export type QueueMonitorListener = (event: QueueMonitorEvent) => void;
export type QueueMonitorDispatcher = (event: QueueMonitorEvent) => void;

interface QueueMonitorEnvironment extends DevtoolsEnvironment {
	PLATFORM_QUEUE_MONITOR?: string;
	PLATFORM_QUEUE_MONITOR_MAX?: string;
	PLATFORM_QUEUE_MONITOR_PAYLOAD?: string;
	PLATFORM_QUEUE_MONITOR_SOURCE?: string;
	npm_package_name?: string;
}

const defaultMaxEntries = 500;

/**
 * Captures queue lifecycle events for local development panels and tests.
 */
export class QueueMonitor {
	private readonly entries: QueueMonitorEvent[] = [];
	private readonly listeners = new Set<QueueMonitorListener>();
	private readonly maxEntries: number;
	private readonly source: string;
	private readonly includePayload: boolean;
	private readonly dispatch?: QueueMonitorDispatcher;

	/**
	 * Creates a queue lifecycle monitor.
	 */
	constructor(options: QueueMonitorOptions = {}) {
		this.maxEntries = normalizePositiveInteger(options.maxEntries, defaultMaxEntries);
		this.source = options.source || 'app';
		this.includePayload = options.includePayload ?? false;
		this.dispatch = options.dispatch;
	}

	/**
	 * Returns queue events retained in memory.
	 */
	recent(): QueueMonitorEvent[] {
		return [...this.entries];
	}

	/**
	 * Removes queue events from the in-memory buffer.
	 */
	clear(): void {
		this.entries.length = 0;
	}

	/**
	 * Subscribes to queue events and returns an unsubscribe callback.
	 */
	subscribe(listener: QueueMonitorListener): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Records one queue job lifecycle event.
	 *
	 * @param input - Queue job lifecycle fields.
	 */
	recordJob(input: QueueMonitorJobEventInput): void {
		this.record({
			type: 'queue.job',
			id: this.eventId(input),
			source: this.source,
			timestamp: input.timestamp ?? new Date().toISOString(),
			action: input.action,
			queue: input.queue,
			jobName: input.jobName,
			jobId: input.jobId,
			jobUuid: input.jobUuid,
			attempts: input.attempts,
			maxTries: input.maxTries,
			delaySeconds: input.delaySeconds,
			durationMs: input.durationMs === undefined ? undefined : roundDuration(input.durationMs),
			errorMessage: input.error === undefined ? undefined : errorMessage(input.error),
			origin: input.origin,
			payloadData: this.includePayload ? input.payloadData : undefined,
		});
	}

	/**
	 * Records one event produced by the always-on queue lifecycle dispatcher.
	 *
	 * @param event - Queue lifecycle event to retain and forward.
	 */
	recordLifecycleEvent(event: queue.QueueLifecycleEvent): void {
		this.recordJob({
			timestamp: event.timestamp,
			action: event.action,
			queue: event.queue,
			jobName: event.jobName,
			jobId: event.jobId,
			jobUuid: event.jobUuid,
			attempts: event.attempts,
			maxTries: event.maxTries,
			delaySeconds: event.delaySeconds,
			durationMs: event.durationMs,
			error: event.error,
			origin: event.origin,
			payloadData: event.payloadData,
		});
	}

	/**
	 * Creates a stable id for terminal failures and a unique id for lifecycle events.
	 *
	 * A job UUID keeps repeated terminal instrumentation deliveries as one panel row.
	 *
	 * @param input - Queue event fields used to identify a terminal failure.
	 * @returns Stable failed-event id or a fresh lifecycle event id.
	 */
	private eventId(input: QueueMonitorJobEventInput): string {
		if (input.action === 'failed' && input.jobUuid) {
			return `queue-failed:${input.jobUuid}`;
		}

		return randomUUID();
	}

	/**
	 * Retains an event and notifies local plus external subscribers.
	 */
	private record(event: QueueMonitorEvent): void {
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
 * Enables the environment-default queue monitor when the runtime opts in.
 */
export function enableDefaultQueueMonitor(
	options: QueueMonitorOptions | false | undefined = undefined,
	env: QueueMonitorEnvironment = process.env,
): QueueMonitor | null {
	if (options === false) return null;

	const defaults = defaultQueueMonitorOptions(env);
	const resolved = defaults || options
		? {
			...(defaults ?? {}),
			...(options ?? {}),
		}
		: null;

	if (!resolved) return null;

	return new QueueMonitor(resolved);
}

/**
 * Resolves queue monitor defaults from development and observability env vars.
 */
export function defaultQueueMonitorOptions(
	env: QueueMonitorEnvironment = process.env,
): QueueMonitorOptions | null {
	const mode = queueMonitorMode(env.PLATFORM_QUEUE_MONITOR, env.NODE_ENV);

	if (!mode) return null;

	return {
		source: env.PLATFORM_QUEUE_MONITOR_SOURCE || env.npm_package_name || 'app',
		maxEntries: parseIntegerEnv(env.PLATFORM_QUEUE_MONITOR_MAX, defaultMaxEntries),
		includePayload: booleanEnv(
			env.PLATFORM_QUEUE_MONITOR_PAYLOAD,
			mode === 'full' || (mode === 'dev' && isDevelopmentEnvironment(env.NODE_ENV ?? '')),
		),
		dispatch: createHttpQueueMonitorDispatcher({
			url: devtoolsEventsUrl(env),
		}),
	};
}

/**
 * Creates a fire-and-forget batched HTTP dispatcher for queue events.
 */
export function createHttpQueueMonitorDispatcher(
	options: HttpQueueMonitorDispatcherOptions = {},
): DevtoolsEventDispatcher<QueueMonitorEvent> {
	return createHttpEventDispatcher<QueueMonitorEvent>(options);
}

/**
 * Resolves whether monitoring should be active for the current environment.
 */
function queueMonitorMode(
	input: string | undefined,
	environment: string | undefined,
): QueueMonitorMode | null {
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

		case '0':
		case 'false':
		case 'off':
			return null;

		default:
			return isInteractiveDevelopmentEnvironment(environment) ? 'dev' : null;
	}
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
 * Returns a positive integer or the supplied fallback.
 */
function normalizePositiveInteger(input: unknown, fallback: number): number {
	const value = Number(input);

	if (!Number.isFinite(value) || value <= 0) return fallback;

	return Math.trunc(value);
}
