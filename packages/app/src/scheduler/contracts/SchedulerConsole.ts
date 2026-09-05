import type { Scheduler } from '../Scheduler';
import type { Logger } from '../../logging';

/**
 * Parsed scheduler command name, positional arguments, and long options.
 */
export interface ParsedSchedulerConsoleArgs {
	/** Command selected by the caller. */
	command: string;
	/** Positional command arguments. */
	args: string[];
	/** Parsed `--name=value` or `--name value` options. */
	options: Record<string, string | boolean>;
}

/**
 * Minimum application surface required by the framework scheduler console.
 */
export interface SchedulerConsoleApp {
	/** Application scheduler with all application definitions registered. */
	scheduler: Scheduler;
	/** Application logger used by the long-running scheduler when available. */
	log?: Logger;
	/** Releases database, queue, and other process resources. */
	close(): void | Promise<void>;
}

/**
 * Application hooks and help customisation for scheduler console commands.
 */
export interface SchedulerConsoleOptions {
	/** Resolves the active application instance after bootstrap. */
	app: () => SchedulerConsoleApp;
	/** Prepares schema, queue jobs, and schedule definitions. */
	bootstrap?: () => void | Promise<void>;
	/** Optional application-specific help text. */
	helpText?: string;
	/** Optional application-specific unknown-command message. */
	unknownCommandMessage?: (command: string) => string;
}
