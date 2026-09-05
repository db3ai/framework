import { FileFlowDefinitionStore, Flows } from '@db3.ai/app/flows';
import { App, type AppOptions } from '@db3.ai/app/server';
import { normalizeTextBlock } from './normalizeTextBlock';
import { uppercaseTextBlock } from './uppercaseTextBlock';

/** Application-owned boot wiring shared by request producers and queue workers. */
export class FlowExampleApp extends App {
	readonly #definitionRoot: string;
	/** Creates the app; the caller owns its definition directory and database. */
	constructor(options: AppOptions, definitionRoot: string) { super(options); this.#definitionRoot = definitionRoot; }
	/** Lazily registers the durable flow-step handler and the app's block types. */
	get flows(): Flows {
		return this.service('flows', () => new Flows({ queue: this.queue, queueName: 'flows', maxTries: 1, definitions: new FileFlowDefinitionStore({ root: this.#definitionRoot }), blocks: [normalizeTextBlock, uppercaseTextBlock] }));
	}
}
