import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register, type ScopedImport } from 'tsx/esm/api';
import { Cli } from './Cli';
import { createReplCommand } from './commands/repl';
import type * as cli from './contracts';

// Cache the import before scoped loaders alter hooks; avoid the CLI/Queue barrel cycle.
let queueModule: Promise<typeof import('../queue/commands')> | undefined;

/** Loads one app's command registry and releases its TypeScript loader after use. */
export async function withDb3Cli<T>(options: cli.CliOptions, use: (runner: Cli) => Promise<T>): Promise<T> {
	const { queueCommands } = await (queueModule ??= import('../queue/commands'));
	const loader = register({ namespace: `db3-cli-${randomUUID()}` });
	try {
		const directory = resolve(options.directory ?? process.cwd());
		const configModule = await loadAppModule(directory, 'server/cli.config', loader.import);
		const config: cli.CliConfig = configModule ? configModule.default : { commands: [] };
		// Validate app config before combining it with commands that need no app bootstrap.
		if (!config || !Array.isArray(config.commands)) throw new Error('CLI configuration must export a commands array.');
		const repl = createReplCommand(async () => loadReplModels(directory, loader.import), options);
		return await use(new Cli({ ...config, commands: [repl, ...queueCommands, ...config.commands] }, { ...options, directory }));
	} finally {
		await loader.unregister();
	}
}

/** Loads an optional conventional app module without hiding errors from its imports. */
async function loadAppModule(directory: string, path: string, importModule: ScopedImport): Promise<Record<string, any> | undefined> {
	for (const extension of ['ts', 'mjs', 'js']) {
		const file = resolve(directory, `${path}.${extension}`);
		try { await access(file); } catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
			throw error;
		}
		return importModule(pathToFileURL(file).href, import.meta.url);
	}
	return undefined;
}

/** Exposes named model constructors from the same registry used by app migrations. */
async function loadReplModels(directory: string, importModule: ScopedImport): Promise<Record<string, unknown>> {
	const module = await loadAppModule(directory, 'server/database/models', importModule);
	if (!module) return {};
	if (!Array.isArray(module.models)) throw new Error('server/database/models must export a models array for the REPL.');
	const models: Record<string, unknown> = Object.create(null);
	for (const model of module.models) {
		if (typeof model !== 'function' || !/^[A-Za-z_$][\w$]*$/.test(model.name)) throw new Error('REPL models must be named constructors.');
		if (['app', 'models', '__proto__', 'constructor', 'prototype'].includes(model.name) || Object.hasOwn(models, model.name)) throw new Error(`Duplicate or reserved REPL model name: ${model.name}`);
		models[model.name] = model;
	}
	return models;
}
