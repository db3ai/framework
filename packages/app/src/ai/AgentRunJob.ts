import { QueueableJob } from '@db3.ai/app/queue';
import { queuedAgentFromPayload } from './registry.js';
import type { QueuedAgentRunPayload } from './contracts/Agent';

export const AGENT_RUN_JOB_NAME = 'AgentRunJob';

/**
 * Runs a prepared persisted agent request from a queue worker.
 */
export class AgentRunJob extends QueueableJob<QueuedAgentRunPayload> {
	static jobName = AGENT_RUN_JOB_NAME;

	/**
	 * Creates a validated queued agent run.
	 *
	 * @param data - Persisted agent run identity and input.
	 */
	constructor(data: QueuedAgentRunPayload) {
		super(queuedAgentRunPayload(data));
	}

	/**
	 * Rebuilds the requested agent and resumes its queued run.
	 *
	 * @returns Promise that resolves after the queued run completes.
	 */
	async handle(): Promise<void> {
		const agent = await queuedAgentFromPayload(this.data);

		await agent.runQueued(this.data);
	}
}

/**
 * Validates data used to resume an agent run.
 *
 * @param value - Unknown job data value.
 * @returns Validated queued agent run data.
 */
function queuedAgentRunPayload(value: unknown): QueuedAgentRunPayload {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Invalid agent run job payload.');
	}

	const payload = value as Record<string, unknown>;

	if (
		typeof payload.agentName !== 'string'
		|| typeof payload.agent !== 'object'
		|| payload.agent === null
		|| Array.isArray(payload.agent)
		|| typeof payload.message !== 'string'
		|| typeof payload.metadata !== 'object'
		|| payload.metadata === null
		|| Array.isArray(payload.metadata)
		|| typeof payload.conversationId !== 'string'
		|| (typeof payload.aiRequestId !== 'string' && payload.aiRequestId !== null)
		|| typeof payload.traceId !== 'string'
		|| typeof payload.model !== 'string'
	) {
		throw new Error('Invalid agent run job payload.');
	}

	return payload as unknown as QueuedAgentRunPayload;
}
