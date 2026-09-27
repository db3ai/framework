import { withDb3Cli } from './withDb3Cli';
import type * as cli from './contracts';

/**
 * Discovers registered and built-in commands without creating the application.
 * Configuration imports must remain free of startup side effects, as for CLI help.
 * @param options - App root containing server/cli.config.ts, .mjs or .js.
 * @returns Serializable command descriptions, including terminal-only capabilities.
 */
export async function listDb3Commands(options: Pick<cli.CliOptions, 'directory'> = {}): Promise<cli.CliCommandInfo[]> {
	return withDb3Cli(options, async runner => runner.commands());
}
