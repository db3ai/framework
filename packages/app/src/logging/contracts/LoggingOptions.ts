import type { LogTransportOptions } from './LogTransportOptions';
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
	/** Explicit destinations replace default console/file/devtools selection. An empty array disables output. */
	transports?: LogTransportOptions[];
	/** Optional JSON log file retained outside the process/container. The operator owns rotation and retention. */
	file?: string;
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
	/** Writes logs to standard output. Defaults to true. */
	console?: boolean;
	/**
	 * Console presentation only; files and devtools always retain structured JSON.
	 * Auto (the default) uses pretty output in development terminals and JSON
	 * elsewhere. Set PLATFORM_LOG_FORMAT to override the default process-wide.
	 */
	consoleFormat?: 'auto' | 'pretty' | 'json';
	/**
	 * Streams logs to Platform devtools.
	 *
	 * Interactive development enables this automatically. Pass false to opt out
	 * or an options object to configure delivery explicitly.
	 */
	devtools?: boolean | DevtoolsLogOptions;
}
