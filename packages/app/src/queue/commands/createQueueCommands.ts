import type { CliCommand, CliCommandContext, CliOption } from '../../cli';
import { queueConsoleSelection, runQueueCommand, type QueueConsoleOptions, type ParsedQueueConsoleArgs } from '../console';

/** Long options accepted by both queue dispatch and retained-failure retry commands. */
const dispatchOptions: readonly CliOption[] = [
	{ name: 'queue', type: 'string', description: 'Exact queue to receive this delivery.' },
	{ name: 'delay', type: 'number', min: 0, description: 'Delay before the delivery is available, in seconds.' },
	{ name: 'tries', type: 'number', integer: true, min: 1, description: 'Maximum attempts before terminal failure.' },
];

/** Builds framework worker/dispatch/retry commands from application-owned pool configuration. */
export function createQueueCommands(configuration: Pick<QueueConsoleOptions, 'workers'> = {}): CliCommand[] {
	return [
		{ name: 'queue:work', aliases: ['queue'], description: 'Run a queue worker until stopped, or check once with --once.', execution: 'worker',
			arguments: [{ name: 'queue' }], options: [
				{ name: 'queue', type: 'string', description: 'Consume one exact queue.' },
				{ name: 'queues', type: 'string', description: 'Comma-separated queues, or quoted * for all queues.' },
				{ name: 'exclude-queues', type: 'string', description: 'Comma-separated queues this worker must not claim.' },
				{ name: 'pool', type: 'string', description: 'Use an application-defined pool and its admission settings.' },
				{ name: 'once', type: 'boolean', description: 'Process at most one available job, then exit.' },
				{ name: 'interval', type: 'number', integer: true, min: 1, description: 'Polling/backoff interval in milliseconds.' },
				{ name: 'max-jobs', type: 'number', integer: true, min: 1, description: 'Maximum jobs processed per worker tick.' },
				{ name: 'name', type: 'string', description: 'Process title for the worker.' },
				{ name: 'verbose', type: 'boolean', description: 'Include idle and job lifecycle diagnostics.' },
			],
			/** Checks pool admission before booting the application, then awaits the actual worker lifecycle. */
			async run(context) { await executeQueueCommand('queue:work', configuration, context); },
		},
		{ name: 'queue:dispatch', description: 'Dispatch a registered job with a JSON object payload.', arguments: [{ name: 'job', required: true }, { name: 'data' }], options: dispatchOptions,
			/** Dispatches using the same application preparation and service adapter as legacy consoles. */
			async run(context) { await executeQueueCommand('queue:dispatch', configuration, context); },
		},
		{ name: 'queue:retry', description: 'Replay one retained terminal queue failure.', arguments: [{ name: 'id', required: true }], options: dispatchOptions,
			/** Replays through the configured transport without changing the historical failure. */
			async run(context) { await executeQueueCommand('queue:retry', configuration, context); },
		},
	];
}

/** Adapts validated CLI values while keeping app creation/shutdown with the outer runner. */
async function executeQueueCommand(command: string, configuration: Pick<QueueConsoleOptions, 'workers'>, context: CliCommandContext): Promise<void> {
	const parsed: ParsedQueueConsoleArgs = { command, args: [...context.args], options: {} };
	for (const [key, value] of Object.entries(context.options)) if (value !== undefined) parsed.options[key] = typeof value === 'boolean' ? value : String(value);
	if (command === 'queue:work') queueConsoleSelection(parsed, configuration.workers);
	const application = await context.prepareApp();
	const title = process.title;
	try { await runQueueCommand({ ...configuration, app: () => application, closeApp: false, signal: context.signal }, parsed); }
	finally { process.title = title; }
}
