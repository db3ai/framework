import { resolve } from 'node:path';
import type { App } from '../server';
import { parseCommandArguments, validateCommandOptions } from './parseCommandArguments';
import type * as cli from './contracts';

/** Validates and executes registered service commands with one owned app lifecycle. */
export class Cli {
	readonly #commands = new Map<string, cli.CliCommand>();
	readonly #names = new Map<string, cli.CliCommand>();
	readonly #config: cli.CliConfig;
	readonly #directory: string;
	readonly #write: (message: string) => void;
	readonly #writeError: (message: string) => void;
	readonly #signal?: AbortSignal;

	/**
	 * Registers commands and aliases without starting an application or its services.
	 * @param config - Lazy host factory, operational preparation and command definitions.
	 * @param options - App root, cancellation and terminal adapters owned by this invocation.
	 */
	constructor(config: cli.CliConfig, options: cli.CliOptions = {}) {
		if (!config || !Array.isArray(config.commands)) throw new Error('CLI configuration must export a commands array.');
		if (config.createApp !== undefined && typeof config.createApp !== 'function') throw new Error('CLI createApp must be a function.');
		if (config.prepareApp !== undefined && typeof config.prepareApp !== 'function') throw new Error('CLI prepareApp must be a function.');
		this.#config = config;
		this.#directory = resolve(options.directory ?? process.cwd());
		this.#write = options.write ?? console.log;
		this.#writeError = options.writeError ?? console.error;
		this.#signal = options.signal;
		for (const command of config.commands) {
			if (!command || typeof command.description !== 'string' || typeof command.run !== 'function') throw new Error('Invalid CLI command definition.');
			if (command.aliases !== undefined && !Array.isArray(command.aliases)) throw new Error('CLI aliases must be an array.');
			if (command.arguments !== undefined && !Array.isArray(command.arguments)) throw new Error('CLI arguments must be an array.');
			if (command.options !== undefined && !Array.isArray(command.options)) throw new Error('CLI options must be an array.');
			if (command.execution !== undefined && !['once', 'worker', 'interactive'].includes(command.execution)) throw new Error('Invalid CLI execution kind.');
			for (const name of [command.name, ...(command.aliases ?? [])]) {
				if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_-]*)*$/.test(name)) throw new Error('Invalid CLI command definition.');
				if (this.#names.has(name)) throw new Error(`Duplicate CLI command: ${name}`);
				this.#names.set(name, command);
			}
			let optional = false;
			const parameters = new Set<string>();
			for (const argument of command.arguments ?? []) {
				if (typeof argument.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(argument.name) || parameters.has(argument.name) || optional && argument.required) throw new Error(`Invalid argument declaration for ${command.name}.`);
				parameters.add(argument.name);
				if (!argument.required) optional = true;
			}
			validateCommandOptions(command);
			this.#commands.set(command.name, command);
		}
	}

	/** Returns detached descriptions without exposing executable handlers or app configuration. */
	commands(): cli.CliCommandInfo[] {
		return [...this.#commands.values()].map(command => {
			const execution = command.execution ?? (command.interactive ? 'interactive' : 'once');
			return {
				name: command.name,
				aliases: [...(command.aliases ?? [])],
				description: command.description,
				arguments: (command.arguments ?? []).map(argument => ({ ...argument })),
				options: (command.options ?? []).map(option => structuredClone(option)),
				execution,
				interactive: execution !== 'once' || Boolean(command.interactive),
			};
		});
	}

	/**
	 * Runs one invocation, awaiting worker drain and closing a created app on failure too.
	 * @param argv - Literal arguments after the executable name.
	 * @returns Process-compatible exit status; never exits the hosting process.
	 */
	async run(argv: readonly string[]): Promise<number> {
		if (argv.length === 0 || argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) {
			this.#write(['Usage: db3 <command> [arguments] [options]', '', ...[...this.#commands.values()].map(command => `${usage(command)}\n  ${command.description}${command.aliases?.length ? ` (aliases: ${command.aliases.join(', ')})` : ''}`)].join('\n'));
			return 0;
		}
		const command = this.#names.get(argv[0]!);
		if (!command) { this.#writeError(`Unknown command: ${argv[0]}. Run db3 --help from your app root; app commands are registered in server/cli.config.ts.`); return 1; }
		const values = argv.slice(1);
		const end = values.indexOf('--');
		if (values.some((value, index) => (end < 0 || index < end) && ['--help', '-h'].includes(value))) {
			this.#write([usage(command, argv[0]), command.description,
				...(command.options ?? []).map(option => `  --${option.name}${option.type === 'boolean' ? '' : `=<${option.type}>`}  ${option.description}${option.default !== undefined ? ` (default: ${JSON.stringify(option.default)})` : ''}`)].join('\n'));
			return 0;
		}
		let parsed: ReturnType<typeof parseCommandArguments>;
		try { parsed = parseCommandArguments(command, values); }
		catch (error) { this.#writeError(`${errorMessage(error)} Usage: ${usage(command, argv[0])}`); return 1; }
		let application: App | undefined;
		let pendingApplication: Promise<App> | undefined;
		let pendingPreparation: Promise<App> | undefined;
		const controller = new AbortController();
		/** Requests cooperative worker shutdown; service adapters own draining. */
		const stop = (): void => { controller.abort(); };
		this.#signal?.addEventListener('abort', stop, { once: true });
		if (this.#signal?.aborted) stop();
		const worker = command.execution === 'worker';
		if (worker) { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
		/** Creates the invocation's app once, even for concurrent requests. */
		const createApp = (): Promise<App> => pendingApplication ??= Promise.resolve().then(async () => {
			if (!this.#config.createApp) throw new Error('This command requires createApp in server/cli.config.ts.');
			application = await this.#config.createApp();
			return application;
		});
		let status = 0;
		let reportedError: unknown;
		try {
			if (controller.signal.aborted) return worker ? 0 : 130;
			const result = await command.run({ ...parsed, signal: controller.signal, directory: this.#directory, write: this.#write, app: createApp,
				/** Keeps operational bootstrap separate from schema and metadata commands. */
				prepareApp: () => pendingPreparation ??= createApp().then(async instance => { await this.#config.prepareApp?.(instance); return instance; }),
			});
			status = result ?? 0;
			if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error(`Command ${command.name} returned an invalid exit status.`);
		} catch (error) { reportedError = error; this.#writeError(errorMessage(error)); status = 1; }
		finally {
			try { await pendingApplication; await pendingPreparation; }
			catch (error) { if (error !== reportedError) this.#writeError(errorMessage(error)); status = 1; }
			if (application) {
				try { await application.close(); }
				catch (error) { this.#writeError(`Application shutdown failed: ${errorMessage(error)}`); status = 1; }
			}
			this.#signal?.removeEventListener('abort', stop);
			if (worker) { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
		}
		return status;
	}
}

/** Formats usage from the authoritative argument and option declarations. */
function usage(command: cli.CliCommand, name = command.name): string {
	return [`db3 ${name}`, ...(command.arguments ?? []).map(argument => argument.required ? `<${argument.name}>` : `[${argument.name}]`), ...(command.options?.length ? ['[options]'] : [])].join(' ');
}

/** Produces a concise error without dumping application objects or configuration. */
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Command failed.'; }
