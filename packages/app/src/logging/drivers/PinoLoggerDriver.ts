import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import pino, { type DestinationStream, type Logger as PinoLogger, type TransportTargetOptions } from 'pino';
import type ThreadStream from 'thread-stream';

import { isInteractiveDevelopmentEnvironment } from '../../devtools';
import type * as logging from '../contracts';
import { acquireDevelopmentConsole } from '../acquireDevelopmentConsole';

/**
 * Pino worker transport lifecycle members present at runtime but omitted from
 * the published ThreadStream type.
 */
interface ManagedPinoTransport extends ThreadStream {
	/** Whether the worker has loaded every configured destination. */
	readonly ready: boolean;
	/** Keeps the worker referenced while an explicit lifecycle action runs. */
	ref(): void;
	/** Allows an idle logging worker to stop keeping the process alive. */
	unref(): void;
}

/**
 * Process values used to derive default logging configuration.
 */
interface LoggingEnvironment {
	NODE_ENV?: string;
	PLATFORM_LOG_DEVTOOLS?: string;
	PLATFORM_LOG_LEVEL?: string;
	PLATFORM_LOG_SOURCE?: string;
	PLATFORM_LOG_FILE?: string;
	PLATFORM_LOG_FORMAT?: string;
	npm_package_name?: string;
}

const defaultRedactions = [
	'password',
	'*.password',
	'secret',
	'*.secret',
	'token',
	'*.token',
	'authorization',
	'headers.authorization',
	'headers.cookie',
	'req.headers.authorization',
	'req.headers.cookie',
	'request.headers.authorization',
	'request.headers.cookie',
];

/**
 * Pino-backed logger driver with optional worker-thread devtools delivery.
 */
export class PinoLoggerDriver implements logging.LoggerDriver {
	readonly logger: PinoLogger;
	readonly #transport: ManagedPinoTransport | null;
	readonly #console?: ReturnType<typeof acquireDevelopmentConsole>;
	#closed = false;
	#closing = false;
	#closePromise: Promise<void> | null = null;

	/**
	 * Creates a Pino logger and its configured destinations.
	 *
	 * @param options - Framework logging configuration.
	 * @param destination - Optional direct destination used by focused tests.
	 */
	constructor(
		options: logging.LoggingOptions = {},
		destination?: DestinationStream,
	) {
		const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
		const level = resolveLogLevel(options, process.env);
		const source = options.source
			?? process.env.PLATFORM_LOG_SOURCE
			?? process.env.npm_package_name
			?? 'app';
		const pinoOptions = {
			level,
			base: {
				pid: process.pid,
				hostname: hostname(),
				source,
				environment,
				...options.bindings,
			},
			redact: options.redact === false
				? undefined
				: {
					paths: [...defaultRedactions, ...(options.redact ?? [])],
					remove: true,
				},
		};

		if (destination) {
			this.#transport = null;
			this.logger = pino(pinoOptions, destination);
			return;
		}

		const format = options.consoleFormat ?? process.env.PLATFORM_LOG_FORMAT ?? 'auto';
		if (!['auto', 'pretty', 'json'].includes(format)) throw new Error(`Invalid PLATFORM_LOG_FORMAT value "${format}". Use auto, pretty, or json.`);
		const pretty = options.console !== false && level !== 'silent' && (format === 'pretty' || (format === 'auto' && isInteractiveDevelopmentEnvironment(environment) && Boolean(process.stdout.isTTY)));
		const targets = transportTargets(pretty ? { ...options, console: false } : options, level, environment, process.env);
		if (pretty) {
			this.#transport = targets.length ? pino.transport({ targets }) as ManagedPinoTransport : null;
			this.#transport?.on('error', reportTransportError);
			this.#console = acquireDevelopmentConsole();
			const streams: pino.StreamEntry[] = [{ level: 'trace', stream: this.#console.console }];
			if (this.#transport) streams.push({ level: 'trace', stream: this.#transport });
			this.logger = pino(pinoOptions, pino.multistream(streams));
			return;
		}

		if (targets.length === 0) {
			this.#transport = null;
			this.logger = pino({
				...pinoOptions,
				level: 'silent',
			});
			return;
		}

		if (targets.length === 1 && targets[0]?.target === 'pino/file' && targets[0]?.options?.destination === 1) {
			this.#transport = null;
			this.logger = pino(pinoOptions);
			return;
		}

		this.#transport = pino.transport({
			targets,
		}) as ManagedPinoTransport;
		this.#transport.on('error', reportTransportError);
		this.logger = pino(pinoOptions, this.#transport);
	}

	/**
	 * Waits until Pino has handed accepted records to its destination.
	 */
	async flush(): Promise<void> {
		if (this.#closed) return;

		this.#transport?.ref();

		try {
			if (this.#transport) {
				await waitForTransportReady(this.#transport);
				this.#transport.ref();
			}

			await new Promise<void>((resolve, reject) => {
				const destination = this.#transport ?? this.logger;
				destination.flush((error?: Error) => {
					if (error) {
						reject(error);
						return;
					}

					resolve();
				});
			});
			await this.#console?.console.flush();
		} finally {
			if (!this.#closing) {
				this.#transport?.unref();
			}
		}
	}

	/**
	 * Flushes records and closes the worker transport when one is active.
	 */
	async close(): Promise<void> {
		this.#closePromise ??= this.#close();
		await this.#closePromise;
	}

	/**
	 * Performs the one-time driver shutdown.
	 */
	async #close(): Promise<void> {
		if (this.#closed) return;

		this.#closing = true;
		this.#console?.release();
		await this.flush();
		this.#closed = true;

		if (!this.#transport) return;

		const closed = once(this.#transport, 'close');

		this.#transport.end();
		await closed;
	}
}

/**
 * Resolves the configured standard Pino level.
 *
 * @param options - Explicit application logging options.
 * @param env - Process environment values.
 * @returns Valid standard logging level.
 */
function resolveLogLevel(
	options: logging.LoggingOptions,
	env: LoggingEnvironment,
): logging.LogLevel {
	if (options.enabled === false) return 'silent';

	const candidate = options.level
		?? env.PLATFORM_LOG_LEVEL
		?? ((options.environment ?? env.NODE_ENV) === 'test' ? 'silent' : 'info');

	if (isLogLevel(candidate)) return candidate;

	throw new Error(
		`Invalid PLATFORM_LOG_LEVEL value "${candidate}". Use trace, debug, info, warn, error, fatal, or silent.`,
	);
}

/**
 * Builds Pino transport targets for stdout and Platform devtools.
 *
 * @param options - Framework logging destination options.
 * @param level - Minimum severity routed to each destination.
 * @param environment - Current runtime environment.
 * @param env - Process environment values.
 * @returns Pino worker transport targets.
 */
function transportTargets(
	options: logging.LoggingOptions,
	level: logging.LogLevel,
	environment: string,
	env: LoggingEnvironment,
): TransportTargetOptions[] {
	if (level === 'silent') return [];

	const targets: TransportTargetOptions[] = [];

	if (options.console !== false) {
		targets.push({ target: 'pino/file', level, options: { destination: 1 } });
	}

	const file = options.file ?? env.PLATFORM_LOG_FILE;
	if (file) targets.push({ target: 'pino/file', level, options: { destination: file, mkdir: true } });

	if (devtoolsEnabled(options.devtools, environment, env)) {
		targets.push({
			target: devtoolsTransportTarget(),
			level,
			options: typeof options.devtools === 'object'
				? options.devtools
				: {},
		});
	}

	return targets;
}

/**
 * Resolves whether the devtools transport is enabled.
 *
 * @param configured - Explicit transport setting.
 * @param environment - Current runtime environment.
 * @param env - Process environment values.
 * @returns True when logs should stream to the development service.
 */
function devtoolsEnabled(
	configured: logging.LoggingOptions['devtools'],
	environment: string,
	env: LoggingEnvironment,
): boolean {
	if (configured === false) return false;
	if (configured === true || typeof configured === 'object') return true;

	const envValue = env.PLATFORM_LOG_DEVTOOLS?.toLowerCase().trim();

	if (envValue) {
		return envValue === '1'
			|| envValue === 'true'
			|| envValue === 'yes'
			|| envValue === 'on';
	}

	return isInteractiveDevelopmentEnvironment(environment);
}

/**
 * Resolves the source or compiled transport module beside this driver.
 *
 * @returns Absolute module path suitable for Pino's worker loader.
 */
function devtoolsTransportTarget(): string {
	const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

	return fileURLToPath(
		new URL(`../transports/DevtoolsLogTransport.${extension}`, import.meta.url),
	);
}

/**
 * Narrows a value into one of the supported framework levels.
 *
 * @param input - Candidate log level.
 * @returns True when the value is a standard level.
 */
function isLogLevel(input: unknown): input is logging.LogLevel {
	return input === 'trace'
		|| input === 'debug'
		|| input === 'info'
		|| input === 'warn'
		|| input === 'error'
		|| input === 'fatal'
		|| input === 'silent';
}

/**
 * Surfaces transport boot failures without recursively invoking the logger.
 *
 * @param error - Worker transport error.
 */
function reportTransportError(error: Error): void {
	process.stderr.write(`[logging] Transport failed: ${error.message}\n`);
}

/**
 * Waits for an asynchronous Pino worker to accept flush requests.
 *
 * The timeout also keeps short-lived command processes alive while the worker
 * loads its transport module.
 *
 * @param transport - Pino worker transport.
 */
async function waitForTransportReady(
	transport: ManagedPinoTransport,
): Promise<void> {
	if (transport.ready) return;

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error('Logging transport did not become ready within 5 seconds.'));
		}, 5000);

		/**
		 * Resolves after the worker has loaded its destination.
		 */
		const onReady = (): void => {
			cleanup();
			resolve();
		};

		/**
		 * Rejects when the worker closes before initialization.
		 */
		const onClose = (): void => {
			cleanup();
			reject(new Error('Logging transport closed before becoming ready.'));
		};

		/**
		 * Rejects when the worker cannot load its destination.
		 *
		 * @param error - Worker initialization error.
		 */
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};

		/**
		 * Removes readiness listeners after one terminal outcome.
		 */
		const cleanup = (): void => {
			clearTimeout(timeout);
			transport.off('ready', onReady);
			transport.off('close', onClose);
			transport.off('error', onError);
		};

		transport.once('ready', onReady);
		transport.once('close', onClose);
		transport.once('error', onError);
	});
}
