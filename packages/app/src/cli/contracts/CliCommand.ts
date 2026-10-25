import type { App } from '../../server';
import type { CliOption, CliOptionValue } from './CliOption';

/** One positional value accepted by a command, in declaration order. */
export interface CliArgument {
	/** Name displayed in command usage. */
	name: string;
	/** Whether omission is a usage error. Required arguments precede optional ones. */
	required?: boolean;
}

/** Invocation state supplied by the runner to a service-owned command. */
export interface CliCommandContext {
	/** Validated positional values, excluding the command name. */
	args: readonly string[];
	/** Validated long options; unknown options never reach a handler. */
	options: Readonly<Record<string, CliOptionValue | undefined>>;
	/** Aborted by SIGINT/SIGTERM for a long-running command; the action owns draining. */
	signal: AbortSignal;
	/** Absolute application root used for app-owned source generation. */
	directory: string;
	/** Lazily creates one application, which the runner closes after execution. */
	app(): Promise<App>;
	/** Prepares application jobs/apps/schedules once, only for operational commands. */
	prepareApp(): Promise<App>;
	/** Writes one user-facing output message. */
	write(message: string): void;
}

/** A service or application command, backed by its existing programmatic operation. */
export interface CliCommand {
	/** Unique command name, for example db:migrate or queue:make-job. */
	name: string;
	/** Additional invocation names sharing the same definition and lifecycle. */
	aliases?: readonly string[];
	/** Short explanation shown by db3 --help. */
	description: string;
	/** Positional argument declarations used for validation and help. */
	arguments?: readonly CliArgument[];
	/** Declared long options used by validation, help and discovery. */
	options?: readonly CliOption[];
	/** Worker commands remain awaited until their signal-driven drain finishes. */
	execution?: 'once' | 'worker' | 'interactive';
	/** Requires a terminal lifecycle; one-shot visual runners must exclude it. */
	interactive?: boolean;
	/** Executes the operation; return a nonzero status for a reported failure. */
	run(context: CliCommandContext): number | void | Promise<number | void>;
}
