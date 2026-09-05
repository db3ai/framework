import type { LoggerDriver } from './LoggerDriver';
import type { LogBindings, LogLevel } from './Logger';

/**
 * HTTP delivery settings for the Platform development log transport.
 */
export interface DevtoolsLogOptions {
	/** Explicit event ingestion endpoint, overriding devtools environment values. */
	url?: string;
	/** Maximum log records sent in one HTTP request. */
	batchSize?: number;
	/** Maximum delay before a partial log batch is sent. */
	flushIntervalMs?: number;
	/** Pause before later records are attempted after a failed request. */
	retryAfterMs?: number;
	/** Maximum duration allowed for one ingestion request. */
	requestTimeoutMs?: number;
	/** Maximum unsent records retained before the oldest record is discarded. */
	maxPendingEvents?: number;
	/** Additional ingestion headers, such as a future service token. */
	headers?: Record<string, string>;
}

/**
 * Application logging configuration.
 */
export interface LoggingOptions {
	/** Injectable logging driver used by tests or alternate implementations. */
	driver?: LoggerDriver;
	/** Minimum emitted severity. Defaults to info, or silent in tests. */
	level?: LogLevel;
	/** Human-readable application or process name attached to every record. */
	source?: string;
	/** Runtime environment copied onto every record. */
	environment?: string;
	/** Disables all logging when false. */
	enabled?: boolean;
	/** Stable fields attached to every root logger record. */
	bindings?: LogBindings;
	/** Sensitive field paths removed before records reach any destination. */
	redact?: false | string[];
	/** Writes newline-delimited JSON to standard output. Defaults to true. */
	console?: boolean;
	/**
	 * Streams logs to Platform devtools.
	 *
	 * Interactive development enables this automatically. Pass false to opt out
	 * or an options object to configure delivery explicitly.
	 */
	devtools?: boolean | DevtoolsLogOptions;
}
