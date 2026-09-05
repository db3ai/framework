import type { ChildLoggerOptions, LogFn } from 'pino';

/**
 * Standard severity levels supported by the framework logger.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/**
 * Structured fields attached to one log record or child logger.
 */
export type LogBindings = Record<string, unknown>;

/**
 * Application logger contract shared by framework services and app code.
 *
 * The call signatures intentionally match Pino so structured records can be
 * passed directly to Fastify and Pino-compatible transports.
 */
export interface Logger {
	/** Minimum severity currently emitted by the logger. */
	level: string;
	/** Writes a highly detailed diagnostic record. */
	trace: LogFn;
	/** Writes a development diagnostic record. */
	debug: LogFn;
	/** Writes a normal operational record. */
	info: LogFn;
	/** Writes a recoverable problem record. */
	warn: LogFn;
	/** Writes a failed operation record. */
	error: LogFn;
	/** Writes a process-ending failure record. */
	fatal: LogFn;
	/** Accepts a record without emitting output. */
	silent: LogFn;

	/**
	 * Creates a logger that includes stable fields on every record.
	 *
	 * @param bindings - Structured context inherited by child records.
	 * @param options - Optional Pino child logger behavior.
	 * @returns Child logger sharing the same destinations.
	 */
	child(bindings: LogBindings, options?: ChildLoggerOptions): Logger;
}
