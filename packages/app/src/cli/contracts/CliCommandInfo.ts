import type { CliArgument } from './CliCommand';

/** Serializable command metadata for explorers; never includes executable handlers or configuration. */
export interface CliCommandInfo {
	/** Unique registered command name. */
	name: string;
	/** Human-readable purpose shown in help and visual explorers. */
	description: string;
	/** Ordered positional inputs accepted by the CLI. */
	arguments: readonly CliArgument[];
	/** Interactive commands require a terminal session instead of a one-shot form. */
	interactive: boolean;
}
