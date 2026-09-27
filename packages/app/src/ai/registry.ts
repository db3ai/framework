import type { SerializableClass, SerializedValueEnvelope } from '@db3.ai/app/serialization';
import { app } from '../server/appContext';
import type { Agent } from './Agent';
import type { QueuedAgentRunPayload } from './contracts/Agent';

/**
 * Registers one concrete agent class for durable reconstruction.
 *
 * Call this during application boot in both HTTP and worker processes.
 *
 * @param agentName - Stable persisted agent name.
 * @param AgentClass - Constructor accepting the state returned by `toJSON()`.
 * @returns Nothing.
 */
export function registerQueuedAgent(
	agentName: string,
	AgentClass: SerializableClass<any, Agent>,
): void {
	app().serializer.registry.registerClass(agentName, AgentClass);
}

/**
 * Serializes one agent before its queued run creates persistence side effects.
 *
 * @param agentName - Stable persisted agent name.
 * @param agent - Concrete agent instance to serialize.
 * @returns Versioned agent constructor-state envelope.
 */
export async function serializeQueuedAgent(
	agentName: string,
	agent: Agent,
): Promise<SerializedValueEnvelope> {

	if (!app().serializer.registry.classForName(agentName)) {
		throw new Error(`No queued agent registered for "${agentName}".`);
	}

	const envelope = app().serializer.serialize(agent);

	if (envelope.name !== agentName) {
		throw new Error(`Serialized agent envelope "${envelope.name}" does not match "${agentName}".`);
	}

	return envelope;
}

/**
 * Rebuilds an agent instance from one queued run payload.
 *
 * @param payload - Queued run payload containing a serialized agent envelope.
 * @returns Agent instance ready to resume the prepared run.
 */
export async function queuedAgentFromPayload(payload: QueuedAgentRunPayload): Promise<Agent> {

	if (payload.agent.name !== payload.agentName) {
		throw new Error(`Queued agent envelope "${payload.agent.name}" does not match "${payload.agentName}".`);
	}

	if (!app().serializer.registry.classForName(payload.agentName)) {
		throw new Error(`No queued agent registered for "${payload.agentName}".`);
	}

	const restored = await app().serializer.deserialize<Agent>(payload.agent);

	if (!restored || typeof restored.runQueued !== 'function') {
		throw new Error(`Registered queued agent "${payload.agentName}" did not restore an agent runtime.`);
	}

	return restored;
}
