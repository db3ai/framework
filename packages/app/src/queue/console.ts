import { parseJsonRecord, unknownErrorMessage } from '@db3.ai/pure';

import type { Logger } from '../logging';
import type * as queue from './contracts';
import type { Queue } from './Queue';
import { QueueWorker } from './QueueWorker';

interface QueueConsoleLogOptions {
	verbose?: boolean;
}

export interface ParsedQueueConsoleArgs {
	command: string;
	args: string[];
	options: Record<string, string | boolean>;
}

export interface QueueConsoleApp {
	queue: Queue;
	/** Application logger used by long-running queue workers when available. */
	log?: Logger;
	close(): void | Promise<void>;
}

export interface QueueConsoleCommandContext {
	parsed: ParsedQueueConsoleArgs;
	app: QueueConsoleApp;
	dispatchOptions(): queue.DispatchOptions;
	optionString(name: string): string | undefined;
	optionBoolean(name: string): boolean;
	optionNumber(name: string, fallback?: string): number | undefined;
}

export interface QueueConsoleCommand {
	command: string;
	bootstrap?: boolean;
	close?: boolean;
	run(context: QueueConsoleCommandContext): void | Promise<void>;
}

/** Application bootstrap, named worker selections and extra commands shared by queue CLI invocations. */
export interface QueueConsoleOptions {
	app: () => QueueConsoleApp;
	/** Checked-in worker selections selected with --pool=<name>; credentials remain in the application environment. */
	workers?: Readonly<Record<string, queue.QueueSelection>>;
	bootstrap?: () => void | Promise<void>;
	commands?: QueueConsoleCommand[];
	helpText?: string;
	unknownCommandMessage?: (command: string) => string;
}

export async function runQueueConsole(
	options: QueueConsoleOptions,
	argv = process.argv.slice(2),
): Promise<void> {
	const parsed = parseQueueConsoleArgs(argv);

	switch (parsed.command) {
		case 'queue:work':
			await bootstrap(options);
			await workQueue(options, parsed);
			return;

		case 'queue:dispatch':
			await bootstrap(options);
			{
				const app = options.app();

				try {
					await dispatchQueueJob(app, parsed);
				} finally {
					await app.close();
				}
			}
			return;

		case 'queue:retry':
			await bootstrap(options);
			{
				const app = options.app();

				try {
					await retryFailedQueueJob(app, parsed);
				} finally {
					await app.close();
				}
			}
			return;

		case 'queue:help':
		case 'help':
		case '':
			printHelp(options);
			return;
	}

	const command = options.commands?.find(candidate => {
		return candidate.command === parsed.command;
	});

	if (command) {
		if (command.bootstrap !== false) {
			await bootstrap(options);
		}

		const context = createCommandContext(options, parsed);

		try {
			await command.run(context);
		} finally {
			if (command.close !== false) {
				await context.app.close();
			}
		}

		return;
	}

	throw new Error(
		options.unknownCommandMessage?.(parsed.command)
			?? `Unknown queue command "${parsed.command}".`,
	);
}

export function parseQueueConsoleArgs(argv: string[]): ParsedQueueConsoleArgs {
	const [command = '', ...rest] = argv;
	const args: string[] = [];
	const options: Record<string, string | boolean> = {};

	for (let index = 0; index < rest.length; index += 1) {
		const value = rest[index];

		if (!value.startsWith('--')) {
			args.push(value);
			continue;
		}

		const [rawKey, inlineValue] = value.slice(2).split('=', 2);
		const key = rawKey.trim();

		if (!key) continue;

		if (inlineValue !== undefined) {
			options[key] = inlineValue;
			continue;
		}

		const next = rest[index + 1];

		if (next && !next.startsWith('--')) {
			options[key] = next;
			index += 1;
			continue;
		}

		options[key] = true;
	}

	return {
		command,
		args,
		options,
	};
}

export function queueConsoleOptionString(
	parsed: ParsedQueueConsoleArgs,
	name: string,
): string | undefined {
	const value = parsed.options[name];

	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function queueConsoleOptionBoolean(
	parsed: ParsedQueueConsoleArgs,
	name: string,
): boolean {
	const value = parsed.options[name];

	return value === true || value === 'true' || value === '1';
}

export function queueConsoleOptionNumber(
	parsed: ParsedQueueConsoleArgs,
	name: string,
	fallback?: string,
): number | undefined {
	const rawValue = parsed.options[name] ?? fallback;

	if (rawValue === undefined || rawValue === true) return undefined;
	if (typeof rawValue === 'string' && rawValue.trim() === '') return undefined;

	const value = Number(rawValue);

	if (!Number.isFinite(value)) return undefined;

	return value;
}

export function queueConsoleDispatchOptions(
	parsed: ParsedQueueConsoleArgs,
): queue.DispatchOptions {
	return {
		queue: queueConsoleOptionString(parsed, 'queue'),
		delaySeconds: queueConsoleOptionNumber(parsed, 'delay'),
		maxTries: queueConsoleOptionNumber(parsed, 'tries'),
	};
}

/**
 * Resolves the process title for a long-running queue worker.
 *
 * @param parsed - Parsed console arguments.
 * @returns Process title to show in system process lists.
 */
export function queueConsoleWorkerProcessTitle(parsed: ParsedQueueConsoleArgs): string {
	return queueConsoleOptionString(parsed, 'name')
		|| queueConsoleEnvString('QUEUE_WORKER_NAME')
		|| 'queue-worker';
}

export function logQueueProcessResult(
	result: queue.QueueProcessResult,
	options: QueueConsoleLogOptions = {},
): void {
	const job = result.job;
	const label = `${job.payload.job}#${job.id}`;

	if (result.status === 'succeeded') {
		console.log(
			`[queue] Processed ${label} on "${job.queue}".${queueConsoleVerboseNextJobMessage(job, options)}`,
		);
		return;
	}

	if (result.status === 'released') {
		console.warn(
			`[queue] Released ${label} after attempt ${job.attempts}/${job.payload.maxTries}; retrying in ${result.delaySeconds ?? 0}s. ${unknownErrorMessage(result.error)}`,
		);
		return;
	}

	if (result.status === 'deferred') {
		console.warn(
			`[queue] Deferred ${label}; retrying in ${result.delaySeconds ?? 0}s. ${unknownErrorMessage(result.error)}`,
		);
		return;
	}

	if (result.status === 'lease_lost') {
		console.warn(
			`[queue] Stopped fenced ${label} attempt ${job.attempts}; lease ownership could not be confirmed. ${unknownErrorMessage(result.error)}`,
		);
		return;
	}

	console.error(
		`[queue] Failed ${label} after ${job.attempts}/${job.payload.maxTries} attempts. ${unknownErrorMessage(result.error)}`,
	);
}

/**
 * Logs that a queue job has been claimed in one-off worker mode.
 *
 * @param job - Claimed queue job.
 * @param options - Console logging options.
 */
export function logQueueClaimed(
	job: queue.QueueJob,
	options: QueueConsoleLogOptions = {},
): void {
	const label = `${job.payload.job}#${job.id}`;

	console.log(
		`[queue] Claimed ${label} on "${job.queue}" attempt ${job.attempts}/${job.payload.maxTries}.`,
	);

	if (!options.verbose) return;

	console.log(
		`[queue] Running ${label}; payload keys: ${queueConsolePayloadKeys(job)}; next on success: ${queueConsoleNextJobLabel(job) ?? 'none'}.`,
	);
}

async function bootstrap(options: QueueConsoleOptions): Promise<void> {
	await options.bootstrap?.();
}

/** Runs a configured worker selection, with identical admission for one-shot and polling execution. */
async function workQueue(
	options: QueueConsoleOptions,
	parsed: ParsedQueueConsoleArgs,
): Promise<void> {
	const selection = queueConsoleSelection(parsed, options.workers);
	const queue = selection.queues === '*' ? '*' : selection.queues?.join(', ') ?? 'default';
	const once = queueConsoleOptionBoolean(parsed, 'once');
	const verbose = queueConsoleVerbose(parsed);

	if (!once) {
		process.title = queueConsoleWorkerProcessTitle(parsed);
	}

	const app = options.app();

	if (once) {
		try {
			if (verbose) {
				console.log(`[queue] Checking "${queue}" once.`);
			}

			const result = await new QueueWorker(app.queue, selection).workOnce({
				onClaimed: job => logQueueClaimed(job, {
					verbose,
				}),
			});

			if (!result) {
				console.log(`[queue] No jobs available on "${queue}".`);
				return;
			}

			logQueueProcessResult(result, {
				verbose,
			});
		} finally {
			await app.close();
		}
		return;
	}

	const worker = app.queue.startWorker(selection, {
		force: true,
		logger: app.log?.child({
			component: 'queue-worker',
		}) ?? console,
		verbose,
		intervalMs: queueConsoleOptionNumber(parsed, 'interval', process.env.QUEUE_WORKER_INTERVAL_MS),
		maxJobsPerTick: queueConsoleOptionNumber(parsed, 'max-jobs', process.env.QUEUE_WORKER_MAX_JOBS_PER_TICK),
	});

	if (!worker) {
		throw new Error('Queue worker could not start.');
	}

	let shuttingDown = false;
	const shutdown = async (signal: string) => {
		if (shuttingDown) return;

		shuttingDown = true;
		console.log(`[queue] Received ${signal}; stopping worker.`);
		await worker.stopAndDrain();
		await app.close();
		process.exit(0);
	};

	process.on('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
}

/**
 * Resolves one worker selection from explicit CLI flags or a checked-in named pool.
 * Pool admission cannot be silently broadened by combining it with queue flags.
 */
export function queueConsoleSelection(parsed: ParsedQueueConsoleArgs, workers: QueueConsoleOptions['workers'] = {}): queue.QueueSelection {
	for (const flag of ['pool', 'queues', 'queue', 'exclude-queues']) {
		if (Object.hasOwn(parsed.options, flag) && queueConsoleOptionString(parsed, flag) === undefined) throw new Error(`--${flag} requires a non-empty value.`);
	}
	const pool = queueConsoleOptionString(parsed, 'pool');
	const queues = queueConsoleOptionString(parsed, 'queues');
	const single = queueConsoleOptionString(parsed, 'queue') || parsed.args[0];
	const excluded = queueConsoleOptionString(parsed, 'exclude-queues');
	if (pool) {
		if (queues !== undefined || single !== undefined || excluded !== undefined) throw new Error('--pool cannot be combined with queue selection flags.');
		if (!Object.hasOwn(workers, pool)) throw new Error(`Unknown worker pool "${pool}".`);
		return workers[pool]!;
	}
	if (queues !== undefined && single !== undefined) throw new Error('Use --queues or --queue, not both.');
	const names = queues ?? single ?? process.env.QUEUE_NAME ?? 'default';
	return {
		queues: names === '*' ? '*' : names.split(',').map(name => name.trim()),
		excludeQueues: excluded === undefined ? [] : excluded.split(',').map(name => name.trim()),
	};
}

async function dispatchQueueJob(
	app: QueueConsoleApp,
	parsed: ParsedQueueConsoleArgs,
): Promise<void> {
	const name = parsed.args[0];

	if (!name) {
		throw new Error('Provide a job name, for example: queue:dispatch TestLogJob \'{"message":"Hello"}\'');
	}

	const data = parseJsonRecord(parsed.args[1] ?? '{}', 'Job data must be a JSON object.');
	const id = await app.queue.dispatch(name, data, queueConsoleDispatchOptions(parsed));

	console.log(`[queue] Dispatched ${name} as job ${id}.`);
}

/**
 * Replays one persisted terminal queue failure.
 *
 * @param app - Bootstrapped application exposing the queue service.
 * @param parsed - Parsed command arguments and dispatch overrides.
 */
async function retryFailedQueueJob(
	app: QueueConsoleApp,
	parsed: ParsedQueueConsoleArgs,
): Promise<void> {
	const failedJobId = parsed.args[0];

	if (!failedJobId) {
		throw new Error('Provide a failed job id, for example: queue:retry 206');
	}

	const replacementId = await app.queue.retryFailed(
		failedJobId,
		queueConsoleDispatchOptions(parsed),
	);

	console.log(`[queue] Retried failed job ${failedJobId} as job ${replacementId}.`);
}

function createCommandContext(
	options: QueueConsoleOptions,
	parsed: ParsedQueueConsoleArgs,
): QueueConsoleCommandContext {
	return {
		parsed,
		app: options.app(),
		dispatchOptions: () => queueConsoleDispatchOptions(parsed),
		optionString: name => queueConsoleOptionString(parsed, name),
		optionBoolean: name => queueConsoleOptionBoolean(parsed, name),
		optionNumber: (name, fallback) => queueConsoleOptionNumber(parsed, name, fallback),
	};
}

function printHelp(options: QueueConsoleOptions): void {
	console.log(options.helpText ?? defaultHelpText());
}

/**
 * Builds the default queue console help text shown by framework consumers.
 */
function defaultHelpText(): string {
	return `Queue commands

  queue:work [--queue=default]
  queue:work --once
  queue:dispatch <job> '{"key":"value"}'
  queue:retry <failed-job-id>
  queue:help

Options:
  --queue=<name>       Queue name, defaults to "default".
  --queues=<names|*>  Worker queue names, comma-separated; quote '*'.
  --exclude-queues=<names>  Exact queue names this worker cannot claim.
  --pool=<name>        Checked-in worker selection; cannot combine with queue flags.
  --delay=<seconds>    Delay before the job is available.
  --tries=<count>      Maximum attempts before jobs_failed.
  --once               Process one available job, then exit.
  --interval=<ms>      Worker polling interval.
  --max-jobs=<count>   Jobs processed per worker tick.
  --name=<name>        Process title for long-running workers.
  --verbose            Show idle polls, payload keys, and chained next jobs.
`;
}

/**
 * Resolves whether verbose queue worker logging should be enabled.
 *
 * @param parsed - Parsed console arguments.
 * @returns True when verbose logging is enabled by flag or environment.
 */
function queueConsoleVerbose(parsed: ParsedQueueConsoleArgs): boolean {
	return queueConsoleOptionBoolean(parsed, 'verbose')
		|| queueConsoleEnvBoolean('QUEUE_WORKER_VERBOSE')
		|| queueConsoleEnvBoolean('QUEUE_VERBOSE');
}

/**
 * Reads a boolean-like value from the process environment.
 *
 * @param name - Environment variable name.
 * @returns True when the environment value enables a setting.
 */
function queueConsoleEnvBoolean(name: string): boolean {
	const value = process.env[name];

	return value === 'true' || value === '1' || value === 'yes';
}

/**
 * Reads a trimmed string value from the process environment.
 *
 * @param name - Environment variable name.
 * @returns Trimmed environment value when present.
 */
function queueConsoleEnvString(name: string): string | undefined {
	const value = process.env[name];

	return value?.trim() || undefined;
}

/**
 * Returns a verbose suffix describing the next chained job.
 *
 * @param job - Completed queue job.
 * @param options - Console logging options.
 * @returns Empty string or a sentence fragment for the next queued job.
 */
function queueConsoleVerboseNextJobMessage(
	job: queue.QueueJob,
	options: QueueConsoleLogOptions,
): string {
	if (!options.verbose) return '';

	const next = queueConsoleNextJobLabel(job);

	return next ? ` Queued next ${next}.` : ' No chained job remains.';
}

/**
 * Returns a readable list of payload keys for terminal output.
 *
 * @param job - Queue job whose payload data should be described.
 * @returns Comma-separated payload keys or none.
 */
function queueConsolePayloadKeys(job: queue.QueueJob): string {
	const keys = Object.keys(job.payload.data ?? {});

	return keys.length > 0 ? keys.join(', ') : 'none';
}

/**
 * Returns the next chained job name from a queue payload.
 *
 * @param job - Queue job whose chain should be inspected.
 * @returns Next chained job label or null.
 */
function queueConsoleNextJobLabel(job: queue.QueueJob): string | null {
	const [next] = job.payload.chained ?? [];

	return next ? next.displayName || next.job : null;
}
