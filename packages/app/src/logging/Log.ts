import type { ChildLoggerOptions } from 'pino';
import type { Mail } from '../mail';

import { PinoLoggerDriver } from './drivers/PinoLoggerDriver';
import type * as logging from './contracts';

/**
 * Application logging service exposed as `app().log`.
 *
 * Pino supplies the default driver while this service owns framework discovery
 * and lifecycle. Applications may inject a compatible driver in tests.
 *
 * @example
 * app().log.info({ websiteId }, 'Website crawl started');
 */
export class Log implements logging.Logger {
	readonly #driver: logging.LoggerDriver;

	/**
	 * Creates the application logger from explicit options or the Pino driver.
	 *
	 * @param options - Logging level, destinations, context, and driver overrides.
	 * @param mail - Lazy application Mail resolver, required when email is configured.
	 */
	constructor(options: logging.LoggingOptions = {}, mail?: () => Mail) {
		if (options.driver && options.transports !== undefined) throw new Error('Configured logging transports require the default Pino driver.');
		this.#driver = options.driver ?? new PinoLoggerDriver(options, undefined, mail);
	}

	/** Returns the current trace function, respecting runtime level changes. */
	get trace(): logging.Logger['trace'] { return this.#driver.logger.trace.bind(this.#driver.logger); }

	/** Returns the current debug function, respecting runtime level changes. */
	get debug(): logging.Logger['debug'] { return this.#driver.logger.debug.bind(this.#driver.logger); }

	/** Returns the current info function, respecting runtime level changes. */
	get info(): logging.Logger['info'] { return this.#driver.logger.info.bind(this.#driver.logger); }

	/** Returns the current warning function, respecting runtime level changes. */
	get warn(): logging.Logger['warn'] { return this.#driver.logger.warn.bind(this.#driver.logger); }

	/** Returns the current error function, respecting runtime level changes. */
	get error(): logging.Logger['error'] { return this.#driver.logger.error.bind(this.#driver.logger); }

	/** Returns the current fatal function, respecting runtime level changes. */
	get fatal(): logging.Logger['fatal'] { return this.#driver.logger.fatal.bind(this.#driver.logger); }

	/** Returns the driver's non-emitting log function. */
	get silent(): logging.Logger['silent'] { return this.#driver.logger.silent.bind(this.#driver.logger); }

	/**
	 * Returns the minimum severity currently emitted by the driver.
	 */
	get level(): string {
		return this.#driver.logger.level;
	}

	/**
	 * Changes the minimum emitted severity at runtime.
	 *
	 * @param level - Pino-compatible log level.
	 */
	set level(level: string) {
		this.#driver.logger.level = level;
	}

	/**
	 * Returns the underlying compatible logger for framework integrations.
	 *
	 * @returns Driver logger accepted by Fastify and worker adapters.
	 */
	get logger(): logging.Logger {
		return this.#driver.logger;
	}

	/**
	 * Creates a context-bearing child logger.
	 *
	 * @param bindings - Stable structured fields for subsequent records.
	 * @param options - Optional Pino child logger overrides.
	 * @returns Child logger sharing the configured destinations.
	 */
	child(
		bindings: logging.LogBindings,
		options?: ChildLoggerOptions,
	): logging.Logger {
		return this.#driver.logger.child(bindings, options);
	}

	/**
	 * Waits for accepted records to reach their configured destination.
	 */
	async flush(): Promise<void> {
		await this.#driver.flush();
	}

	/**
	 * Flushes records and releases transport resources.
	 */
	async close(): Promise<void> {
		await this.#driver.close();
	}
}
