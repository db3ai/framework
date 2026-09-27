import { withDb3Cli } from './withDb3Cli';
import type * as cli from './contracts';

/**
 * Runs registered framework commands with app-owned startup and cleanup.
 * @param argv - Arguments after db3.
 * @param options - Application root and terminal adapters.
 * @returns Process-compatible exit status without exiting the process.
 */
export async function runDb3(argv: readonly string[], options: cli.CliOptions = {}): Promise<number> {
	try {
		return await withDb3Cli(options, runner => runner.run(argv));
	} catch (error) {
		(options.writeError ?? console.error)(error instanceof Error ? error.message : 'Unable to load CLI configuration.');
		return 1;
	}
}
