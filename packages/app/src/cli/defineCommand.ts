import type * as cli from './contracts';

/**
 * Registers an app-context action with named argument mapping and terminal result formatting.
 *
 * Export action functions separately so UI and programmatic callers receive normal
 * results without terminal output. The runner owns the application lifecycle.
 * @param definition - Service action, parameters and optional result-to-exit-code mapping.
 * @returns Command suitable for app or service registration.
 */
export function defineCommand<TResult>(definition: cli.CommandDefinition<TResult>): cli.CliCommand {
	return {
		name: definition.name,
		description: definition.description,
		arguments: definition.parameters,
		/** Establishes app context, maps parameters and adapts the action result for the terminal. */
		async run(context) {
			if (definition.needsApp !== false) await context.app();
			const parameters = Object.fromEntries((definition.parameters ?? []).map((parameter, index) => [parameter.name, context.args[index]]));
			const result = await definition.handle(parameters, context);
			if (result !== undefined) context.write(definition.formatResult ? definition.formatResult(result) : typeof result === 'string' ? result : JSON.stringify(result, null, 2));
			return definition.exitCode?.(result) ?? 0;
		},
	};
}
