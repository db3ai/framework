import type { CliCommand, CliCommandContext } from '../../cli';
import { runSchedulerCommand } from '../console';
import type { ParsedSchedulerConsoleArgs, SchedulerConsoleOptions } from '../contracts';

/** Application-owned durable progress and health hooks for shared scheduler commands. */
type SchedulerConfiguration = Pick<SchedulerConsoleOptions, 'checkpoint' | 'onTick'>;

/** Registers scheduler operations and the scheduler alias without booting application services. */
export function createSchedulerCommands(configuration: SchedulerConfiguration = {}): CliCommand[] {
	return [
		{ name: 'scheduler:work', aliases: ['scheduler'], execution: 'worker', description: 'Run the scheduler until stopped.',
			/** Keeps the invocation alive until the scheduler finishes its current tick and closes. */
			async run(context) { await executeSchedulerCommand('scheduler:work', configuration, context); },
		},
		{ name: 'scheduler:run', description: 'Evaluate one due scheduler minute without advancing the worker checkpoint.',
			/** Evaluates the existing scheduler operation once. */
			async run(context) { await executeSchedulerCommand('scheduler:run', configuration, context); },
		},
		{ name: 'scheduler:list', description: 'List the application schedule definitions.',
			/** Lists registered definitions without starting worker or provider execution. */
			async run(context) { await executeSchedulerCommand('scheduler:list', configuration, context); },
		},
		{ name: 'scheduler:history', description: 'Read recent durable scheduled occurrences.', options: [
			{ name: 'limit', type: 'number', integer: true, min: 1, max: 200, default: 25, description: 'Maximum retained occurrences to return.' },
			{ name: 'status', type: 'string', description: 'Filter by a scheduler occurrence status.' },
		],
			/** Reads retained history through the scheduler-owned adapter. */
			async run(context) { await executeSchedulerCommand('scheduler:history', configuration, context); },
		},
	];
}

/** Converts validated input without allowing a nested console to close the outer CLI's app. */
async function executeSchedulerCommand(command: string, configuration: SchedulerConfiguration, context: CliCommandContext): Promise<void> {
	const application = await context.prepareApp();
	const parsed: ParsedSchedulerConsoleArgs = { command, args: [...context.args], options: {} };
	for (const [key, value] of Object.entries(context.options)) if (value !== undefined) parsed.options[key] = typeof value === 'boolean' ? value : String(value);
	const title = process.title;
	try { await runSchedulerCommand({ ...configuration, app: () => application, closeApp: false, signal: context.signal }, parsed); }
	finally { process.title = title; }
}
