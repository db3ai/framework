import type { Queue } from '../../queue';
import type { AppDatabaseProvider } from '../../server';
import type { FlowBlockDefinition } from './FlowBlock';
import type { FlowDefinitionStore } from './FlowDefinitionStore';

/**
 * Dependencies and limits used by one application-scoped Flows service.
 */
export interface FlowsOptions {
	/** Existing application queue used to execute durable block jobs. */
	queue: Queue;
	/** Definition provider used to load and save source-of-truth graphs. */
	definitions: FlowDefinitionStore;
	/** Executable block types available to this application. */
	blocks: FlowBlockDefinition[];
	/** Queue/channel used for flow step jobs. Defaults to `flows`. */
	queueName?: string;
	/** Maximum queue attempts for each block step. Defaults to 3. */
	maxTries?: number;
	/** Maximum serialized input or output size retained per boundary. */
	maxPayloadBytes?: number;
}

/**
 * Minimal application shape required by queue-rehydrated flow step jobs.
 */
export interface FlowStepJobApp extends AppDatabaseProvider {
	/** Application-scoped flow service. */
	flows: {
		/**
		 * Executes one durable step claimed by the queue.
		 *
		 * @param runId - Flow run ULID.
		 * @param blockId - Block occurrence ULID.
		 * @param job - Claimed queue job metadata.
		 */
		processStep(runId: string, blockId: string, job: import('../../queue').QueueJob): Promise<void>;
	};
}
