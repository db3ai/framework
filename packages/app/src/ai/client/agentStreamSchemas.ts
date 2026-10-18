import { z } from 'zod';
import type * as stream from '../contracts/AgentConversationStream';
import type { QueuedAgentRunResponse } from '../contracts/AgentProtocol';

const identity = z.string().min(1).max(256);
const text = z.string().max(8_000_000);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const view = z.enum(['admin', 'conversation', 'status']);
const error = z.object({ code: z.string().max(256).optional(), message: text, details: z.unknown().optional() });
const citation = z.object({ id: identity, type: z.literal('url'), url: z.string().max(16_384), title: text, startIndex: sequence, endIndex: sequence });
const progress = z.object({ id: identity, message: text, current: z.number().finite().optional(), total: z.number().finite().optional(), data: z.record(z.string(), z.unknown()).optional(), createdAt: z.string().max(64) });
const definition = z.object({ name: identity, title: text, description: text });
const promptMessages = z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: text })).max(10_000);
const message = z.object({ kind: z.literal('message'), id: identity, role: z.enum(['user', 'assistant']), content: text, citations: z.array(citation).max(1_000), createdAt: z.string().max(64), streaming: z.boolean().optional() });
const reasoning = z.object({ kind: z.literal('reasoning_summary'), id: identity, text, createdAt: z.string().max(64), streaming: z.boolean().optional() });
const prompt = z.object({ kind: z.literal('prompt_context'), id: identity, aiRequestId: identity.nullable(), traceId: identity.nullable(), model: identity.nullable(), createdAt: z.string().max(64), userMessageId: identity.nullable().optional(), messages: promptMessages });
const tool = z.object({ kind: z.literal('tool'), id: identity, toolName: identity, arguments: z.unknown(), state: z.enum(['calling', 'success', 'error']), definition: definition.nullable(), progressUpdates: z.array(progress).max(1_000), result: z.unknown(), error: error.nullable() });
/** Validates full HTTP items and live canonical replacements without server imports. */
export const agentTimelineEntrySchema = z.discriminatedUnion('kind', [message, reasoning, prompt, tool]);
const run = z.object({ aiRequestId: identity, status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'blocked', 'cancelled']), attempt: sequence, startedAt: z.string().max(64).nullable(), completedAt: z.string().max(64).nullable(), error: error.nullable() });
const context = z.object({ model: identity, windowTokens: sequence.nullable(), inputTokens: sequence.nullable(), status: z.enum(['measured', 'compacting', 'compacted']), compactions: sequence });
const activity = z.object({ code: identity, label: text, current: z.number().finite().optional(), total: z.number().finite().optional() });
const usage = z.object({ requests: sequence, inputTokens: z.number().nullable(), outputTokens: z.number().nullable(), totalTokens: z.number().nullable(), reasoningTokens: z.number().nullable(), cachedTokens: z.number().nullable(), cacheWriteTokens: z.number().nullable() });
const event = z.discriminatedUnion('type', [
	z.object({ type: z.literal('item.changed'), item: agentTimelineEntrySchema }),
	z.object({ type: z.literal('history.changed') }),
	z.object({ type: z.literal('text.delta'), delta: text }),
	z.object({ type: z.literal('reasoning.summary.delta'), id: identity, delta: text }),
	z.object({ type: z.literal('reasoning.summary.completed'), id: identity, text, createdAt: z.string().max(64) }),
	z.object({ type: z.literal('citation.added'), citation }),
	z.object({ type: z.literal('tool.calling'), id: identity, toolName: identity, arguments: z.unknown(), toolDefinition: definition.nullable() }),
	z.object({ type: z.literal('tool.success'), id: identity, toolName: identity, arguments: z.unknown().optional(), result: z.unknown() }),
	z.object({ type: z.literal('tool.error'), id: identity, toolName: identity, arguments: z.unknown().optional(), error }),
	z.object({ type: z.literal('tool.progress'), id: identity, toolName: identity, progress }),
	z.object({ type: z.literal('run.state'), run, queued: sequence }),
	z.object({ type: z.literal('context.changed'), context }),
	z.object({ type: z.literal('status.changed'), activity: activity.nullable() }),
	z.object({ type: z.literal('conversation.created'), conversationId: identity, aiRequestId: identity.nullable(), traceId: identity, toolDefinitions: z.array(definition).max(1_000) }),
	z.object({ type: z.literal('message.created'), id: identity, role: z.literal('user'), content: text, createdAt: z.string().max(64) }),
	z.object({ type: z.literal('message.completed'), id: identity, role: z.literal('assistant'), content: text, citations: z.array(citation).max(1_000), createdAt: z.string().max(64) }),
	z.object({ type: z.literal('prompt.context'), id: identity, aiRequestId: identity.nullable(), traceId: identity.nullable(), model: identity.nullable(), createdAt: z.string().max(64), userMessageId: identity.nullable().optional(), messages: promptMessages }),
	z.object({ type: z.literal('run.completed'), conversationId: identity, aiRequestId: identity.nullable(), traceId: identity, usage, creditCost: z.number().nullable(), costUSD: z.number().nullable().optional(), finalOutput: text }),
	z.object({ type: z.literal('run.error'), conversationId: identity.nullable(), aiRequestId: identity.nullable(), traceId: identity.nullable(), error }),
]);
const snapshot = z.object({ context: context.nullable().optional(), conversationId: identity, view, timeline: z.array(agentTimelineEntrySchema).max(1_000), run: run.nullable(), activity: activity.nullable(), older: sequence.nullable(), queued: sequence, attention: z.object({ id: identity, kind: z.enum(['completed', 'failed', 'blocked', 'approval', 'input']), unread: z.boolean() }).nullable().optional() });
const update = z.object({ conversationId: identity, view, aiRequestId: identity, attempt: sequence, itemId: identity.nullable(), event });
const admission = z.object({ jobId: z.union([identity, sequence]), conversationId: identity, aiRequestId: identity.nullable(), traceId: identity });
const stopped = z.object({ conversationId: identity, aiRequestId: identity.nullable(), status: run.shape.status.nullable() });

/** Validates the small admission acknowledgement before the viewer selects its conversation. */
export function parseAgentAdmission(value: unknown): QueuedAgentRunResponse {
	bounded(value, 8_192);
	return admission.parse(value);
}

/** Validates a stop acknowledgement without trusting its conversation identity. */
export function parseAgentStop(value: unknown): stream.AgentStopResult {
	bounded(value, 8_192);
	return stopped.parse(value);
}

/** Bounds opaque tool JSON as well as known fields before validating saved history. */
export function parseAgentSnapshot(value: unknown): stream.AgentConversationSnapshot {
	bounded(value, 16_000_000);
	return snapshot.parse(value);
}

/** Rejects oversized or malformed transient frames before applying them to display state. */
export function parseAgentUpdate(value: unknown): stream.AgentLiveUpdate {
	bounded(value, 262_144);
	return update.parse(value);
}

/** Rejects non-JSON values, cycles and excessive opaque tool output at the adapter boundary. */
function bounded(value: unknown, limit: number): void {
	const serialized = JSON.stringify(value);
	if (typeof serialized !== 'string' || serialized.length > limit) throw new Error('Conversation response is too large or invalid.');
}
