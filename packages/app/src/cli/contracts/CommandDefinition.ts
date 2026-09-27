import type { CliArgument, CliCommandContext } from './CliCommand';

/** A named action adapted for terminal invocation without coupling the action to output or exit codes. */
export interface CommandDefinition<TResult> {
	/** Service:action command name, for example db:make-migration. */
	name: string;
	/** Short help description. */
	description: string;
	/** Positional arguments mapped by name before invoking the handler. */
	parameters?: readonly CliArgument[];
	/** Defaults to true; false is for source generators that need no running application. */
	needsApp?: boolean;
	/** Calls the service action with named arguments; validation remains in that action. */
	handle(parameters: Readonly<Record<string, string | undefined>>, context: CliCommandContext): TResult | Promise<TResult>;
	/** Maps a domain result to a terminal exit code. Defaults to success. */
	exitCode?: (result: TResult) => number;
	/** Optional terminal presentation; direct action callers still receive the original result. */
	formatResult?: (result: TResult) => string;
}
