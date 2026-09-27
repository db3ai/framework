import { resolve } from 'node:path';
import type { App } from '../server';
import type * as cli from './contracts';

/** Validates and executes registered service commands with one owned app lifecycle. */
export class Cli {
	readonly #commands = new Map<string, cli.CliCommand>();
	readonly #config: cli.CliConfig;
	readonly #directory: string;
	readonly #write: (message: string) => void;
	readonly #writeError: (message: string) => void;

	/**
	 * Registers explicit commands without booting an application or its services.
	 * @param config - App factory and service-owned command definitions.
	 * @param options - Root directory and output adapters.
	 */
	constructor(config: cli.CliConfig, options: cli.CliOptions = {}) {
		if (!config || !Array.isArray(config.commands)) throw new Error('CLI configuration must export a commands array.');
		if (config.createApp !== undefined && typeof config.createApp !== 'function') throw new Error('CLI createApp must be a function.');
		this.#config = config;
		this.#directory = resolve(options.directory ?? process.cwd());
		this.#write = options.write ?? console.log;
		this.#writeError = options.writeError ?? console.error;
		for (const command of config.commands) {
			if (!command || !/^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)*$/.test(command.name) || typeof command.description !== 'string' || typeof command.run !== 'function') throw new Error('Invalid CLI command definition.');
			if (this.#commands.has(command.name)) throw new Error(`Duplicate CLI command: ${command.name}`);
			let optional = false;
			for (const argument of command.arguments ?? []) {
				if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(argument.name) || (optional && argument.required)) throw new Error(`Invalid argument declaration for ${command.name}.`);
				if (!argument.required) optional = true;
			}
			this.#commands.set(command.name, command);
		}
	}

	/** Returns detached metadata without booting the app or exposing executable handlers. */
	commands(): cli.CliCommandInfo[] {
		return [...this.#commands.values()].map(command => ({
			name: command.name, description: command.description,
			arguments: (command.arguments ?? []).map(argument => ({ ...argument })),
			interactive: command.interactive ?? false,
		}));
	}

	/**
	 * Runs one invocation, printing help without app startup and closing a created app on failure too.
	 * @param argv - Arguments after the executable name.
	 * @returns Process-compatible exit status; this method never exits the process.
	 */
	async run(argv: readonly string[]): Promise<number> {
		if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]!))) {
			this.#write(['Usage: db3 <command> [arguments]', '', ...[...this.#commands.values()].map(command => `${usage(command)}\n  ${command.description}`)].join('\n'));
			return 0;
		}
		const command = this.#commands.get(argv[0]!);
		if (!command) {
			this.#writeError(`Unknown command: ${argv[0]}. Run db3 --help from your app root; service commands are registered in server/cli.config.ts.`);
			return 1;
		}
		const args = argv.slice(1);
		if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
			this.#write(`${usage(command)}\n${command.description}`);
			return 0;
		}
		const parameters = command.arguments ?? [];
		if (args.some(value => value.startsWith('-')) || args.length < parameters.filter(argument => argument.required).length || args.length > parameters.length) {
			this.#writeError(`Invalid arguments. Usage: ${usage(command)}`);
			return 1;
		}
		let application: App | undefined;
		let pendingApplication: Promise<App> | undefined;
		let status = 0;
		let reportedError: unknown;
		try {
			const result = await command.run({
				args, directory: this.#directory, write: this.#write,
				/** Creates the invocation's app once, even when multiple callers await it. */
				app: () => {
					pendingApplication ??= Promise.resolve().then(async () => {
						if (!this.#config.createApp) throw new Error('This command requires createApp in server/cli.config.ts.');
						application = await this.#config.createApp();
						return application;
					});
					return pendingApplication;
				},
			});
			status = result ?? 0;
			if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error(`Command ${command.name} returned an invalid exit status.`);
		} catch (error) {
			reportedError = error;
			this.#writeError(errorMessage(error));
			status = 1;
		} finally {
			// Finish pending startup before releasing resources, including failed commands.
			try { await pendingApplication; } catch (error) {
				if (error !== reportedError) this.#writeError(errorMessage(error));
				status = 1;
			}
			if (application) {
				try { await application.close(); } catch (error) {
					this.#writeError(`Application shutdown failed: ${errorMessage(error)}`);
					status = 1;
				}
			}
		}
		return status;
	}
}

/** Formats command usage from its declared positional arguments. */
function usage(command: cli.CliCommand): string {
	return [`db3 ${command.name}`, ...(command.arguments ?? []).map(argument => argument.required ? `<${argument.name}>` : `[${argument.name}]`)].join(' ');
}

/** Produces a concise terminal error without dumping application objects or configuration. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Command failed.';
}
