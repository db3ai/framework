import { createHash } from 'node:crypto';
import { ActiveRecord } from '@db3.ai/app/db';
import { app } from '../server/appContext';
import { AgentConversationReadError } from './AgentConversations';
import type { AiRequest } from './AiRequest';
import type { QueuedAgentRunResponse } from './contracts/Agent';

/** Admits a SQL queue turn atomically and reuses an actor-scoped submission after a lost HTTP reply. */
export async function agentAdmission(input: { key?: string; actor: string; scope: string; agent: string; payload: unknown }, admit: (binding?: { admissionKey: string; admissionHash: string }) => Promise<QueuedAgentRunResponse>): Promise<QueuedAgentRunResponse> {
	if (input.key !== undefined && (!input.key.trim() || input.key.length > 128)) throw new AgentConversationReadError(400, 'Invalid submission key.');
	const atomic = app().ai.conversations.enabled || input.key !== undefined;
	if (!atomic) return admit();
	if (app().queue.driverName !== 'database') throw new Error('Durable agent admission requires the database queue. Broker admission needs an outbox.');
	const binding = input.key === undefined ? undefined : { admissionKey: hash([input.actor, input.scope, input.agent, input.key]), admissionHash: hash(input.payload) };
	/** A current read also sees a concurrent winner after a savepoint rollback. */
	const existing = async (): Promise<QueuedAgentRunResponse | null> => {
		if (!binding) return null;
		const request = await app().ai.models.request.where('admissionKey', binding.admissionKey).forUpdate().first();
		if (!request) return null;
		if (request.admissionHash !== binding.admissionHash) throw new AgentConversationReadError(409, 'Submission key was already used with different input.');
		return admittedRun(request);
	};
	const previous = await existing();
	if (previous) return previous;
	try {
		return await app().ai.models.request.getDb().transaction(transaction => ActiveRecord.withDb(transaction, () => admit(binding)));
	} catch (error) {
		const winner = await existing();
		if (winner) return winner;
		throw error;
	}
}

/** Returns only committed admission identifiers, never another copy of the prompt or result. */
function admittedRun(request: AiRequest): QueuedAgentRunResponse {
	const data = request.request as { queueJobId?: unknown; traceId?: string } | null;
	if (!request.conversation?.id || (typeof data?.queueJobId !== 'string' && typeof data?.queueJobId !== 'number') || typeof data.traceId !== 'string') throw new Error('Saved agent admission is incomplete.');
	return { conversationId: String(request.conversation.id), aiRequestId: String(request.id), jobId: data.queueJobId, traceId: data.traceId };
}

/** Canonicalizes object key order so transport JSON ordering cannot change submission identity. */
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

/** Preserves array order and serializable primitives while sorting record keys recursively. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
	return value;
}
