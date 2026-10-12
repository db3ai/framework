import { z } from 'zod';
import type { AgentConversationSnapshot, AgentUpdateResult, AgentTimelineEntry } from '../contracts/AgentConversationStream';

const identity = z.string().min(1).max(256);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const view = z.enum(['admin', 'conversation', 'status']);
const cursor = z.object({ conversationId: identity, view, epoch: identity, sequence });
const error = z.object({ code: z.string().optional(), message: z.string(), details: z.unknown().optional() });
const citation = z.object({ url: z.string(), title: z.string().optional() }).passthrough();
const progress = z.object({ id: identity, message: z.string(), current: z.number().optional(), total: z.number().optional(), data: z.record(z.string(), z.unknown()).optional(), createdAt: z.string() });
const message = z.object({ kind: z.literal('message'), id: identity, role: z.enum(['user', 'assistant']), content: z.string(), citations: z.array(citation), createdAt: z.string(), streaming: z.boolean().optional() });
const reasoning = z.object({ kind: z.literal('reasoning_summary'), id: identity, text: z.string(), createdAt: z.string(), streaming: z.boolean().optional() });
const prompt = z.object({ kind: z.literal('prompt_context'), id: identity, aiRequestId: z.string().nullable(), traceId: z.string().nullable(), model: z.string().nullable(), createdAt: z.string(), userMessageId: z.string().nullable().optional(), messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string() })) });
const tool = z.object({ kind: z.literal('tool'), id: identity, toolName: z.string(), arguments: z.unknown(), state: z.enum(['calling', 'success', 'error']), definition: z.object({ name: z.string(), title: z.string(), description: z.string() }).nullable(), progressUpdates: z.array(progress), result: z.unknown(), error: error.nullable() });
const reference = z.object({ kind: z.literal('reference'), id: identity, itemKind: z.enum(['message', 'tool', 'prompt_context', 'reasoning_summary']), key: identity });
/** Validates HTTP items and socket upserts before the shared renderer consumes them. */
export const agentTimelineEntrySchema = z.discriminatedUnion('kind', [message, reasoning, prompt, tool, reference]) as z.ZodType<AgentTimelineEntry>;
const run = z.object({ aiRequestId: identity, status: z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'blocked', 'cancelled']), attempt: sequence, startedAt: z.string().nullable(), completedAt: z.string().nullable(), error: error.nullable() });
const activity = z.object({ code: z.string(), label: z.string(), current: z.number().optional(), total: z.number().optional() });
const event = z.discriminatedUnion('type', [
	z.object({ type: z.literal('item.changed'), item: agentTimelineEntrySchema }),
	z.object({ type: z.literal('text.delta'), delta: z.string() }),
	z.object({ type: z.literal('reasoning.summary.delta'), id: identity, delta: z.string() }),
	z.object({ type: z.literal('citation.added'), citation }),
	z.object({ type: z.literal('tool.progress'), id: identity, toolName: z.string(), progress }),
	z.object({ type: z.literal('run.state'), run }),
	z.object({ type: z.literal('status.changed'), activity: activity.nullable() }),
]);
/** Validates the bounded baseline without importing the server runtime into a browser. */
export const agentSnapshotSchema = z.object({ cursor, timeline: z.array(agentTimelineEntrySchema).max(300), run: run.nullable(), activity: activity.nullable(), older: sequence.nullable() }) as z.ZodType<AgentConversationSnapshot>;
/** Validates all supported committed update forms, including reset instructions. */
export const agentUpdateSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('snapshot_required'), conversationId: identity, view, reason: z.enum(['cursor_expired', 'projection_changed', 'buffer_overflow']) }),
	z.object({ kind: z.literal('updates'), after: cursor, cursor, through: cursor, events: z.array(z.object({ sequence, aiRequestId: identity, attempt: sequence, itemId: z.string().nullable(), event })).max(64), hasMore: z.boolean() }),
]) as z.ZodType<AgentUpdateResult>;
