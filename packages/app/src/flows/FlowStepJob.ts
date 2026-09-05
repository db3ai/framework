import { isUlid } from '@db3.ai/pure/ulid';

import { QueueableJob, type QueueableJobContext } from '../queue';
import { app } from '../server';
import type { FlowStepJobApp } from './contracts';

/**
 * Serialized payload for one queue-backed flow block execution.
 */
export interface FlowStepJobData extends Record<string, unknown> {
	/** Durable flow run ULID. */
	runId: string;
	/** Block occurrence ULID from the run definition snapshot. */
	blockId: string;
}

/**
 * Queueable job that delegates one block execution to the active app Flows service.
 */
export class FlowStepJob extends QueueableJob<FlowStepJobData> {
	static readonly jobName = 'flow.step';

	/**
	 * Creates a durable block step job.
	 *
	 * @param data - Flow run and block identity.
	 */
	constructor(
		data: FlowStepJobData,
	) {
		if (typeof data.runId !== 'string' || !isUlid(data.runId)) {
			throw new Error('FlowStepJob requires a valid runId ULID.');
		}

		if (typeof data.blockId !== 'string' || !isUlid(data.blockId)) {
			throw new Error('FlowStepJob requires a valid blockId ULID.');
		}

		super(data);
	}

	/**
	 * Executes the durable step through the application-scoped Flows service.
	 *
	 * @param context - Claimed queue job metadata.
	 */
	async handle(context: QueueableJobContext): Promise<void> {
		await app<FlowStepJobApp>().flows.processStep(
			this.data.runId,
			this.data.blockId,
			context.job,
		);
	}
}
