import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { ActiveRecord } from '@db3.ai/app/db';
import { app } from '../server/appContext';
import { AgentConversationReadError } from './AgentConversations';
import type { AiRequest } from './AiRequest';
import type { QueuedAgentRunResponse } from './contracts/Agent';

/**
 * Saves one actor-scoped submission before publishing through the ordinary queue API.
 * Preparation owns only AI records; publication is deliberately outside that boundary.
 * Duplicate sends reuse an acknowledged receipt and never create a second delivery.
 * Callers using external queues must commit their own transactions before invoking this API.
 */
export async function agentAdmission<TPrepared>(input: { key?: string; actor: string; scope: string; agent: string; payload: unknown }, prepare: (binding?: { admissionKey: string; admissionHash: string }) => Promise<TPrepared>, publish: (prepared: TPrepared) => Promise<QueuedAgentRunResponse>): Promise<QueuedAgentRunResponse> {
	if (input.key !== undefined && (!input.key.trim() || input.key.length > 128)) throw new AgentConversationReadError(400, 'Invalid submission key.');
	const binding = input.key === undefined ? undefined : { admissionKey: hash([input.actor, input.scope, input.agent, input.key]), admissionHash: hash(input.payload) };
	/** A current read sees a concurrent preparation winner even inside a caller-owned savepoint. */
	const existing = async (): Promise<QueuedAgentRunResponse | null> => {
		if (!binding) return null;
		const request = await app().ai.models.request.where('admissionKey', binding.admissionKey).forUpdate().first();
		if (!request) return null;
		if (request.admissionHash !== binding.admissionHash) throw new AgentConversationReadError(409, 'Submission key was already used with different input.');
		return admittedRun(request);
	};
	const previous = await existing();
	if (previous) return previous;
	let prepared: TPrepared;
	try {
		if (app().ai.conversations.enabled || binding) {
			// Transaction invariant: A duplicate submission must not leave another conversation, input
			// or stream owner when the unique request key loses its race. This saves AI records only;
			// dispatch follows afterwards. A nested savepoint still shares the caller's transaction.
			prepared = await app().ai.models.request.getDb().transaction(transaction => ActiveRecord.withDb(transaction, () => prepare(binding)));
		} else prepared = await prepare();
	} catch (error) {
		const winner = await existing();
		if (winner) return winner;
		throw error;
	}
	return publish(prepared);
}

/**
 * Reuses a saved queue acknowledgement, briefly allowing a concurrent sender to finish dispatch.
 * An interrupted or rejected dispatch remains inspectable and is never silently submitted again.
 */
async function admittedRun(request: AiRequest): Promise<QueuedAgentRunResponse> {
	const deadline = Date.now() + 2000;
	while (true) {
		const data = request.request as { queueJobId?: unknown; traceId?: string } | null;
		if (request.conversation?.id && (typeof data?.queueJobId === 'string' || typeof data?.queueJobId === 'number') && typeof data.traceId === 'string') {
			return { conversationId: String(request.conversation.id), aiRequestId: String(request.id), jobId: data.queueJobId, traceId: data.traceId };
		}
		if (request.status !== 'pending') throw new AgentConversationReadError(409, 'This submission was not confirmed by the queue. Start a new submission to retry.');
		if (Date.now() >= deadline) throw new AgentConversationReadError(409, 'This submission is still awaiting queue acknowledgement. Retry with the same submission key.');
		await setTimeout(50);
		request = await app().ai.models.request.where('id', request.id).forUpdate().firstOrFail();
	}
}

/** Canonicalizes object key order so transport JSON ordering cannot change submission identity. */
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

/** Preserves array order and serializable primitives while sorting record keys recursively. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
	return value;
}
