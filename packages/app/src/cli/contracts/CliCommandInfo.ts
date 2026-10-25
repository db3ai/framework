import type { CliArgument } from './CliCommand';
import type { CliOption } from './CliOption';

/** Serializable command metadata for explorers; never includes executable handlers or configuration. */
export interface CliCommandInfo {
	/** Unique registered command name. */
	name: string;
	/** Aliases invoke the same registered operation. */
	aliases: readonly string[];
	/** Human-readable purpose shown in help and visual explorers. */
	description: string;
	/** Ordered positional inputs accepted by the CLI. */
	arguments: readonly CliArgument[];
	/** Validated option declarations shared with command-specific help. */
	options: readonly CliOption[];
	/** Distinguishes finite operations, workers and interactive terminal sessions. */
	execution: 'once' | 'worker' | 'interactive';
	/** Requires a terminal lifecycle instead of a one-shot form, including workers. */
	interactive: boolean;
}
