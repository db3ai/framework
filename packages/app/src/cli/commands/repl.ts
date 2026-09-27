import { runRepl } from '../runRepl';
import type { CliCommand, CliOptions } from '../contracts';

/**
 * Registers the application REPL using the same module scope as app bootstrap.
 *
 * @param loadModels - Loads the conventional app model registry only when invoked.
 * @param options - Terminal stream adapters for interactive or embedded callers.
 * @returns Built-in command whose app lifecycle remains owned by the CLI runner.
 */
export function createReplCommand(loadModels: () => Promise<Record<string, unknown>>, options: CliOptions): CliCommand {
	return {
		name: 'repl',
		interactive: true, description: 'Explore the application and its models in an interactive terminal.',
		/** Boots the app without an HTTP listener and keeps it alive until REPL exit. */
		async run(context) {
			const application = await context.app();
			const models = await loadModels();
			context.write('DB3 REPL. Use app(), models and model names. Type .exit or press Ctrl+D to quit.');
			await runRepl({
				input: options.input, output: options.output,
				values: {
					...models, models,
					/** Returns the invocation's live application service hub. */
					app: () => application,
				},
			});
		},
	};
}
