import { unknownErrorMessage } from '@db3.ai/pure';

import { SCHEDULED_OCCURRENCE_STATUSES } from './constants';
import type * as scheduler from './contracts';
import { ScheduledOccurrence } from './ScheduledOccurrence';
import type { Scheduler } from './Scheduler';
import { SchedulerWorker } from './SchedulerWorker';

/**
 * Runs one framework scheduler console command.
 *
 * `scheduler:work` remains alive and evaluates schedules every minute. The
 * other commands bootstrap, execute once, and close application resources.
 *
 * @param options - Application factory, bootstrap hook, and help overrides.
 * @param argv - Command arguments without the Node executable or script path.
 */
export async function runSchedulerConsole(
	options: scheduler.SchedulerConsoleOptions,
	argv = process.argv.slice(2),
): Promise<void> {
	const parsed = parseSchedulerConsoleArgs(argv);

	switch (parsed.command) {
		case 'scheduler:work':
			await bootstrap(options);
			await workScheduler(options);
			return;

		case 'scheduler:run':
			await runWithApp(options, async app => {
				const result = await app.scheduler.runDue();

				logRunResult(result);

				if (result.failures.length > 0) {
					throw new Error(`${result.failures.length} scheduled event(s) failed.`);
				}
			});
			return;

		case 'scheduler:list':
			await runWithApp(options, app => {
				for (const definition of app.scheduler.definitions()) {
					console.log(
						`${definition.name}\t${definition.kind}\tdaily at ${definition.frequency.time}\t${definition.timezone}${definition.jobName ? `\t${definition.jobName}` : ''}`,
					);
				}
			});
			return;

		case 'scheduler:history':
			await runWithApp(options, async () => {
				await printHistory(parsed);
			});
			return;

		case 'scheduler:help':
		case 'help':
		case '':
			printHelp(options);
			return;
	}

	throw new Error(
		options.unknownCommandMessage?.(parsed.command)
			?? `Unknown scheduler command "${parsed.command}".`,
	);
}

/**
 * Parses scheduler console positional arguments and long options.
 *
 * @param argv - Command arguments without the executable or script path.
 * @returns Parsed command input.
 */
export function parseSchedulerConsoleArgs(
	argv: string[],
): scheduler.ParsedSchedulerConsoleArgs {
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

/**
 * Runs a one-off command against a bootstrapped application and closes it.
 *
 * @param options - Scheduler console options.
 * @param callback - Command body receiving the active application.
 */
async function runWithApp(
	options: scheduler.SchedulerConsoleOptions,
	callback: (app: scheduler.SchedulerConsoleApp) => void | Promise<void>,
): Promise<void> {
	await bootstrap(options);

	const app = options.app();

	try {
		await callback(app);
	} finally {
		await app.close();
	}
}

/**
 * Starts the dedicated scheduler worker until the process receives a signal.
 *
 * @param options - Scheduler console options with a bootstrapped app factory.
 */
async function workScheduler(
	options: scheduler.SchedulerConsoleOptions,
): Promise<void> {
	process.title = process.env.SCHEDULER_NAME?.trim() || 'scheduler';

	const app = options.app();

	app.scheduler.definitions();

	const worker = new SchedulerWorker(app.scheduler, {
		logger: app.log ? schedulerLogger(app.log) : undefined,
	});
	let shuttingDown = false;

	/**
	 * Requests an orderly worker stop for an operating-system signal.
	 *
	 * @param signal - Signal received by the scheduler process.
	 */
	const shutdown = (signal: string): void => {
		if (shuttingDown) return;

		shuttingDown = true;
		console.log(`[scheduler] Received ${signal}; stopping worker.`);
		worker.stop();
	};

	/**
	 * Stops the scheduler after SIGINT.
	 */
	const onSigint = (): void => {
		shutdown('SIGINT');
	};

	/**
	 * Stops the scheduler after SIGTERM.
	 */
	const onSigterm = (): void => {
		shutdown('SIGTERM');
	};

	process.once('SIGINT', onSigint);
	process.once('SIGTERM', onSigterm);

	try {
		await worker.start();
	} finally {
		process.removeListener('SIGINT', onSigint);
		process.removeListener('SIGTERM', onSigterm);
		await app.close();
	}
}

/**
 * Adapts the structured application logger to scheduler worker semantics.
 *
 * @param logger - Application logger shared by the scheduler process.
 * @returns Scheduler logger with component context and structured errors.
 */
function schedulerLogger(
	logger: NonNullable<scheduler.SchedulerConsoleApp['log']>,
): scheduler.SchedulerLogger {
	const child = logger.child({
		component: 'scheduler-worker',
	});

	return {
		info: message => child.info(message),
		warn: message => child.warn(message),
		error: (message, error) => {
			if (error === undefined) {
				child.error(message);
				return;
			}

			child.error({
				err: error,
			}, message);
		},
	};
}

/**
 * Prints recent scheduled occurrence history in newest-first order.
 *
 * @param parsed - Parsed command options containing an optional limit.
 */
async function printHistory(
	parsed: scheduler.ParsedSchedulerConsoleArgs,
): Promise<void> {
	const limit = schedulerConsoleLimit(parsed);
	let query = ScheduledOccurrence.query()
		.orderBy('scheduledFor', 'desc')
		.limit(limit);
	const status = schedulerConsoleOptionString(parsed, 'status');

	if (status) {
		query = query.where('status', schedulerStatus(status));
	}

	const occurrences = await query.all();

	if (occurrences.length === 0) {
		console.log('[scheduler] No scheduled occurrences found.');
		return;
	}

	for (const occurrence of occurrences) {
		console.log([
			occurrence.scheduledFor?.toISOString() ?? '-',
			occurrence.name ?? '-',
			occurrence.kind ?? '-',
			occurrence.status ?? '-',
			occurrence.queueJobId ?? '-',
			occurrence.attempts ?? 0,
			occurrence.lastError?.split('\n', 1)[0] ?? '-',
		].join('\t'));
	}
}

/**
 * Resolves and validates the bounded scheduler history limit.
 *
 * @param parsed - Parsed scheduler command options.
 * @returns History row limit between one and two hundred.
 */
function schedulerConsoleLimit(
	parsed: scheduler.ParsedSchedulerConsoleArgs,
): number {
	const rawValue = schedulerConsoleOptionString(parsed, 'limit') ?? '25';
	const limit = Number(rawValue);

	if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
		throw new Error('Scheduler history limit must be an integer from 1 to 200.');
	}

	return limit;
}

/**
 * Validates a scheduler occurrence status filter.
 *
 * @param value - Raw console option value.
 * @returns Validated occurrence status.
 */
function schedulerStatus(value: string): scheduler.ScheduledOccurrenceStatus {
	if (!SCHEDULED_OCCURRENCE_STATUSES.includes(value as scheduler.ScheduledOccurrenceStatus)) {
		throw new Error(`Invalid scheduler status "${value}".`);
	}

	return value as scheduler.ScheduledOccurrenceStatus;
}

/**
 * Returns a trimmed string option when present.
 *
 * @param parsed - Parsed command input.
 * @param name - Option name without leading dashes.
 * @returns Trimmed string option or undefined.
 */
function schedulerConsoleOptionString(
	parsed: scheduler.ParsedSchedulerConsoleArgs,
	name: string,
): string | undefined {
	const value = parsed.options[name];

	return typeof value === 'string' && value.trim()
		? value.trim()
		: undefined;
}

/**
 * Runs an optional application bootstrap hook.
 *
 * @param options - Scheduler console options.
 */
async function bootstrap(options: scheduler.SchedulerConsoleOptions): Promise<void> {
	await options.bootstrap?.();
}

/**
 * Prints the configured or framework-default scheduler help.
 *
 * @param options - Scheduler console options.
 */
function printHelp(options: scheduler.SchedulerConsoleOptions): void {
	console.log(options.helpText ?? defaultHelpText());
}

/**
 * Builds the default scheduler command help.
 *
 * @returns Framework scheduler help text.
 */
function defaultHelpText(): string {
	return `Scheduler commands

  scheduler:work
  scheduler:run
  scheduler:list
  scheduler:history [--limit=25] [--status=failed]
  scheduler:help
`;
}

/**
 * Prints a concise result from one scheduler evaluation.
 *
 * @param result - Completed scheduler evaluation.
 */
function logRunResult(
	result: Awaited<ReturnType<Scheduler['runDue']>>,
): void {
	console.log(
		`[scheduler] ${result.evaluatedFor.toISOString()} due=${result.due} claimed=${result.claimed} dispatched=${result.dispatched} completed=${result.completed} skipped=${result.skipped} failed=${result.failures.length}.`,
	);

	for (const failure of result.failures) {
		console.error(
			`[scheduler] Scheduled event "${failure.name}" failed: ${unknownErrorMessage(failure.error)}`,
		);
	}
}
