import { fileURLToPath } from 'node:url';

import { FileFlowDefinitionStore, Flows } from '@db3.ai/app/flows';
import { App as FrameworkApp, type AppOptions as FrameworkAppOptions } from '@db3.ai/app/server';

import { flowBlocks } from './flow-blocks/index.js';

const definitionsRoot = fileURLToPath(new URL('./flows', import.meta.url));

/**
 * Flow Lab application service hub.
 *
 * It deliberately owns its database, queue, block registry, and file definition
 * provider so the experimental module remains invisible to other applications.
 */
export class App extends FrameworkApp {
	static #instance: App | null = null;

	/**
	 * Returns the process-wide Flow Lab app instance.
	 *
	 * @param options - Optional framework service overrides used by tests.
	 * @returns Shared Flow Lab application.
	 */
	static create(options: FrameworkAppOptions = {}): App {
		return this.#instance ??= new App(options);
	}

	/**
	 * Clears the process-wide instance between isolated tests.
	 */
	static reset(): void {
		this.#instance = null;
	}

	/**
	 * Creates the isolated Flow Lab application.
	 *
	 * @param options - Framework database and queue options.
	 */
	private constructor(options: FrameworkAppOptions = {}) {
		super(options);
	}

	/**
	 * Returns the application-scoped flow runtime and definition repository.
	 *
	 * @returns Configured flow framework service.
	 */
	get flows(): Flows {
		return this.service('flows', () => new Flows({
			queue: this.queue,
			queueName: 'flows',
			definitions: new FileFlowDefinitionStore({
				root: definitionsRoot,
			}),
			blocks: flowBlocks,
		}));
	}
}

/**
 * Returns the process-wide Flow Lab application.
 *
 * @returns Shared Flow Lab app.
 */
export function app(): App {
	return App.create();
}

/**
 * Recreates the process-wide Flow Lab application.
 *
 * @returns Fresh Flow Lab app.
 */
export function resetApp(): App {
	App.reset();
	return app();
}
