import { AgentStreamRecorder } from '../AgentStreamRecorder';
import type { AgentPersistenceState } from '../contracts/Agent';
import { z } from 'zod';
import type { RunContext } from '@openai/agents';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { ActiveRecord } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Agent, AgentConversations, AgentRunJob, AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, registerQueuedAgent, agentConversationTimeline, agentToolOutputWithModelAttachments, tool, emitAgentToolProgress, type AgentRunContext, type AgentTool } from '@db3.ai/app/ai';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';

/** Minimal registered agent; real provider protocol is supplied by the test boundary. */
class StreamingAgent extends Agent {
	/** Keeps the provider request deterministic. */
	instructions(): string { return 'Answer briefly.'; }
	/** No external side effects are needed to prove durable output. */
	protected tools(): AgentTool[] { return []; }
}

let database: GeneratedTestDatabase;
let application: App;
const fetch = vi.fn<typeof globalThis.fetch>();
let receiver: Server;
let available = true;
let publicationGate: Promise<void> | undefined;
const published: Array<{ data: import('../contracts/AgentConversationStream').AgentLiveUpdate }> = [];
const reader = { userId: 'viewer', scopeId: 'team' };
const runChanges: Array<{ id: string; status: string; queued: number }> = [];
let activityDeliveryFails = false;

/** Observes the public lifecycle callback without replacing execution or persistence. */
function onRunStateChanged(conversation: AiConversation): void {
	if (activityDeliveryFails) throw new Error('Activity transport unavailable');
	runChanges.push({ id: String(conversation.id), status: conversation.streamState!.run.status, queued: conversation.streamState?.pending?.length ?? 0 });
}

/** Emits valid SDK SSE while allowing a test to pause between text and completion. */
function controlledResponse() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let sequence = 0;
	let finished = false;
	const response = { id: 'resp_stream', object: 'response', created_at: 1, model: 'test-model', status: 'in_progress', output: [], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
	const item = { type: 'message', id: 'msg_stream', role: 'assistant', status: 'in_progress', content: [] };
	/** Serializes one provider event without replacing framework execution or persistence. */
	const send = (event: Record<string, unknown>): void => { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`)); };
	const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
	send({ type: 'response.created', response });
	send({ type: 'response.output_item.added', output_index: 0, item });
	return {
		/** Models fetch cancellation at the external provider boundary. */
		abort(reason: unknown): void { if (!finished) { finished = true; controller.error(reason); } },
		response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
		/** Advances provider output while the worker remains running. */
		delta(text: string): void { send({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text }); },
		/** Starts a hosted search before the provider emits its completed run item. */
		hostedStart(): void { send({ type: 'response.output_item.added', output_index: 1, item: { type: 'web_search_call', id: 'ws_test', status: 'in_progress' } }); },
		/** Completes the hosted search through the provider's raw lifecycle. */
		hostedFinish(): void { send({ type: 'response.output_item.done', output_index: 1, item: { type: 'web_search_call', id: 'ws_test', status: 'completed', action: { type: 'search', query: 'Example' } } }); },
		/** Exercises the installed SDK's provider-specific model-event wrapper. */
		reasoning(text: string): void {
			send({ type: 'response.reasoning_summary_text.delta', item_id: 'rs_test', output_index: 1, summary_index: 0, delta: text });
			send({ type: 'response.reasoning_summary_text.done', item_id: 'rs_test', output_index: 1, summary_index: 0, text });
		},
		/** Completes the same model call with durable usage and final content. */
		finish(text: string): void {
			if (finished) return;
			finished = true;
			const completed = { ...item, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
			send({ type: 'response.output_item.done', output_index: 0, item: completed });
			send({ type: 'response.completed', response: { ...response, status: 'completed', output: [completed] } });
			controller.close();
		},
	};
}

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	receiver = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		await publicationGate;
		if (available) published.push(JSON.parse(Buffer.concat(chunks).toString()));
		response.writeHead(available ? 200 : 503).end();
	});
	await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
	const port = (receiver.address() as { port: number }).port;
	database = await createGeneratedTestDatabase('agent_stream');
	application = new App({ db: database.db, webSockets: { publish: { url: `http://127.0.0.1:${port}/publish`, token: 'x'.repeat(64) } }, ai: { apiKey: 'synthetic-test-key', model: 'test-model', rateLimiter: false, fetch, streaming: { enabled: true, flushIntervalMs: 5, onRunStateChanged, authorize: context => context.userId === 'viewer', authorizeStop: (context, conversation) => context.userId === conversation.user, projectTool: item => item } }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
	application.queue.registerJob(AgentRunJob);
	registerQueuedAgent('StreamingAgent', StreamingAgent);
});
beforeEach(async () => {
	await application.ai.conversations.drain();
	fetch.mockReset(); available = true; published.length = 0; runChanges.length = 0; activityDeliveryFails = false;
	for (const Model of [AiMessage, AiRequest, AiRateLimitReservation, AiRateLimitBucket, QueuedJob, FailedJob, AiConversation]) await Model.query().delete();
});
afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); await new Promise<void>(resolve => receiver?.close(() => resolve())); vi.unstubAllEnvs(); } });

describe('durable agent streaming', () => {
	it('publishes committed admission, running, followup and completion changes without per-message activity', async () => {
		await expect(application.db.transaction(async () => {
			await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Rollback', { queue: 'activity' });
			expect(runChanges).toEqual([]);
			throw new Error('rollback activity');
		})).rejects.toThrow('rollback activity');
		await application.ai.conversations.drain(); expect(runChanges).toEqual([]);
		const run = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'activity' });
		await application.ai.conversations.drain();
		expect(runChanges).toEqual([{ id: run.conversationId, status: 'queued', queued: 0 }]);
		const provider = controlledResponse(); fetch.mockResolvedValueOnce(provider.response);
		const work = application.queue.workNextJob('activity');
		try {
			await vi.waitFor(() => expect(runChanges.at(-1)?.status).toBe('running'));
			const before = runChanges.length;
			provider.delta('Still working');
			await new Promise(resolve => setTimeout(resolve, 20));
			await application.ai.conversations.drain(); expect(runChanges).toHaveLength(before);
			await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: run.conversationId }).queue('Followup', { queue: 'activity' });
			await application.ai.conversations.drain(); expect(runChanges.at(-1)).toMatchObject({ status: 'running', queued: 1 });
			provider.finish('Done'); expect((await work)?.status).toBe('succeeded');
			await application.ai.conversations.drain(); expect(runChanges.at(-1)).toMatchObject({ status: 'completed', queued: 1 });
			await application.ai.conversations.stop(reader, { conversationId: run.conversationId });
			await application.ai.conversations.drain(); expect(runChanges.at(-1)).toMatchObject({ status: 'completed', queued: 0 });
		} finally { provider.finish('Done'); await work; }
	});

	it('signals retry, terminal recovery and cancellation and tolerates a failed activity publisher', async () => {
		const run = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Retry', { queue: 'activity-retry' });
		await application.ai.conversations.settleQueuedRetry(run.aiRequestId, 1);
		await application.ai.conversations.drain(); expect(runChanges.at(-1)?.status).toBe('waiting');
		await application.ai.conversations.settleQueuedStop(run.aiRequestId, 'Failed');
		await application.ai.conversations.drain(); expect(runChanges.at(-1)?.status).toBe('failed');
		const stopped = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Stop', { queue: 'activity-stop' });
		await application.ai.conversations.stop(reader, { conversationId: stopped.conversationId });
		await application.ai.conversations.drain(); expect(runChanges.at(-1)?.status).toBe('cancelled');
		activityDeliveryFails = true;
		const provider = controlledResponse(); provider.finish('Saved despite transport failure.'); fetch.mockResolvedValueOnce(provider.response);
		const offline = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Offline', { queue: 'activity-offline' });
		expect((await application.queue.workNextJob('activity-offline'))?.status).toBe('succeeded');
		await application.ai.conversations.drain();
		expect((await AiConversation.findOrFail(offline.conversationId)).streamState?.run.status).toBe('completed');
	});

	it('persists completion attention without a viewer and acknowledges only the observed occurrence', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Unread output', { queue: 'attention' });
		const provider = controlledResponse(); provider.finish('Ready to read.'); fetch.mockResolvedValueOnce(provider.response);
		expect((await application.queue.workNextJob('attention'))?.status).toBe('succeeded');
		const service = application.ai.conversations;
		const first = await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' });
		expect(first.attention).toEqual({ id: `${queued.aiRequestId}:completed`, kind: 'completed', unread: true });
		await service.markRead(reader, { conversationId: queued.conversationId, attentionId: first.attention!.id });
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention?.unread).toBe(false);
		await service.requestAttention(queued.conversationId, { id: 'approval-1', kind: 'approval' });
		await service.markRead(reader, { conversationId: queued.conversationId, attentionId: first.attention!.id });
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention).toEqual({ id: 'approval-1', kind: 'approval', unread: true });
		await expect(service.markRead({ userId: 'intruder', scopeId: 'team' }, { conversationId: queued.conversationId, attentionId: 'approval-1' })).rejects.toMatchObject({ statusCode: 404 });
		await expect(service.markRead({ ...reader, scopeId: 'foreign' }, { conversationId: queued.conversationId, attentionId: 'approval-1' })).rejects.toMatchObject({ statusCode: 404 });
		await service.markRead(reader, { conversationId: queued.conversationId, attentionId: 'approval-1' });
		await service.requestAttention(queued.conversationId, { id: 'approval-1', kind: 'approval' });
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention?.unread).toBe(false);
		await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: queued.conversationId }).queue('Follow up', { queue: 'attention' });
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention?.unread).toBe(false);
	});

	it('keeps read receipts per user and delivers attention invalidation only after commit', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Attention', { queue: 'attention' });
		const changed = vi.fn();
		const service = new AgentConversations(application.ai, { enabled: true, authorize: () => true, onAttentionChanged: changed });
		await expect(application.db.knex.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			await service.requestAttention(queued.conversationId, { id: 'rolled-back', kind: 'input' });
			expect(changed).not.toHaveBeenCalled();
			throw new Error('rollback');
		}))).rejects.toThrow('rollback');
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention).toBeNull();
		expect(changed).not.toHaveBeenCalled();
		await service.requestAttention(queued.conversationId, { id: 'saved', kind: 'input' });
		await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
		await Promise.all([service.markRead(reader, { conversationId: queued.conversationId, attentionId: 'saved' }), service.markRead(reader, { conversationId: queued.conversationId, attentionId: 'saved' })]);
		expect((await service.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).attention?.unread).toBe(false);
		expect((await service.load({ userId: 'another', scopeId: 'team' }, { conversationId: queued.conversationId, view: 'conversation' })).attention?.unread).toBe(true);
		expect((await AiConversation.findOrFail(queued.conversationId)).streamState?.attention?.readBy).toEqual(['viewer']);
	});

	it('corrects saved state after transient publication overflows its bounded backlog', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'overflow' });
		await application.ai.conversations.drain(); published.length = 0;
		let release!: () => void;
		publicationGate = new Promise<void>(resolve => { release = resolve; });
		try {
			for (let index = 0; index < 80; index++) application.ai.conversations.publish(queued.conversationId, queued.aiRequestId, 1, { type: 'text.delta', delta: 'x' });
			await application.ai.conversations.stop(reader, { conversationId: queued.conversationId });
		} finally { release(); publicationGate = undefined; }
		await application.ai.conversations.drain();
		expect(published.filter(frame => frame.data.view === 'conversation').at(-1)?.data.event.type).toBe('history.changed');
		expect((await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'conversation' })).run?.status).toBe('cancelled');
	});

	it('cancels a queued turn idempotently, rejects unauthorized controls, and fences old delivery after a new turn', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'stop-test' });
		const input = { conversationId: first.conversationId };
		await expect(application.ai.conversations.stop({ userId: 'stranger' }, input)).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.stop({ ...reader, scopeId: 'wrong' }, input)).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.stop(reader, input)).resolves.toMatchObject({ status: 'cancelled' });
		const stopped = (await AiConversation.findOrFail(first.conversationId)).streamState;
		await expect(application.ai.conversations.stop(reader, input)).resolves.toMatchObject({ status: 'cancelled' });
		expect((await AiConversation.findOrFail(first.conversationId)).streamState).toEqual(stopped);
		const second = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Continue', { queue: 'stop-test' });
		expect((await application.queue.workNextJob('stop-test'))?.status).toBe('failed');
		expect(fetch).not.toHaveBeenCalled();
		expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run).toMatchObject({ aiRequestId: second.aiRequestId, status: 'queued' });
		const provider = controlledResponse(); provider.finish('Continued.'); fetch.mockResolvedValueOnce(provider.response);
		expect((await application.queue.workNextJob('stop-test'))?.status).toBe('succeeded');
		await expect(application.ai.conversations.stop(reader, input)).resolves.toMatchObject({ status: 'completed' });
	});

	it('stops a running provider without saving transient output and leaves a sibling run unaffected', async () => {
		const provider = controlledResponse();
		let providerSignal: AbortSignal | undefined;
		fetch.mockImplementationOnce(async (_url, init) => { providerSignal = init?.signal ?? undefined; providerSignal?.addEventListener('abort', () => provider.abort(providerSignal!.reason), { once: true }); return provider.response; });
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'stop-running' });
		const sibling = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Sibling', { queue: 'sibling' });
		const work = application.queue.workNextJob('stop-running');
		try {
			provider.delta('Keep this partial.');
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			await application.ai.conversations.stop(reader, { conversationId: first.conversationId });
			expect((await work)?.status).toBe('failed');
			expect(providerSignal?.aborted).toBe(true);
			const saved = await application.ai.conversations.load(reader, { conversationId: first.conversationId, view: 'admin' });
			expect(saved.run).toMatchObject({ status: 'cancelled', error: null });
			expect(saved.timeline.some(item => item.kind === 'message' && item.role === 'assistant')).toBe(false);
			expect((await AiConversation.findOrFail(sibling.conversationId)).streamState?.run.status).toBe('queued');
			const next = controlledResponse(); next.finish('Sibling complete.'); fetch.mockResolvedValueOnce(next.response);
			expect((await application.queue.workNextJob('sibling'))?.status).toBe('succeeded');
		} finally { provider.finish('Finished.'); await work; }
	});

	it('observes a stop from another service instance during a silent provider wait', async () => {
		const provider = controlledResponse();
		fetch.mockImplementationOnce(async (_url, init) => { init?.signal?.addEventListener('abort', () => provider.abort(init.signal!.reason), { once: true }); return provider.response; });
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'remote-stop' });
		const work = application.queue.workNextJob('remote-stop');
		try {
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			const remote = new AgentConversations(application.ai, { enabled: true, authorizeStop: context => context.userId === 'viewer' });
			await remote.stop(reader, { conversationId: first.conversationId });
			expect((await work)?.status).toBe('failed');
			expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run.status).toBe('cancelled');
			await remote.drain();
		} finally { provider.finish('Finished'); await work; }
	}, 20_000);

	it('stops an interactive stream and then accepts a fresh turn in the same conversation', async () => {
		const provider = controlledResponse();
		fetch.mockImplementationOnce(async (_url, init) => { init?.signal?.addEventListener('abort', () => provider.abort(init.signal!.reason), { once: true }); return provider.response; });
		let identity: { conversationId: string; aiRequestId: string } | undefined;
		const events: string[] = [];
		const work = new StreamingAgent({ user: 'viewer', scope: 'team' }).stream('Hello', event => {
			if (event.type === 'conversation.created' && event.aiRequestId) identity = { conversationId: event.conversationId, aiRequestId: event.aiRequestId };
			if (event.type === 'run.error') events.push(event.error.code ?? 'unknown');
		});
		try {
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			await application.ai.conversations.stop(reader, identity!);
			expect(await work).toBeNull();
			expect(events).toEqual(['agent_cancelled']);
			const next = controlledResponse(); next.finish('Continued.'); fetch.mockResolvedValueOnce(next.response);
			const result = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: identity!.conversationId }).run('Continue');
			expect(result.finalOutput).toBe('Continued.');
			expect(result.conversationId).toBe(identity!.conversationId);
			expect(result.aiRequestId).not.toBe(identity!.aiRequestId);
		} finally { provider.finish('Finished'); await work; }
	});

	it('keeps a direct stream alive beyond admission and polls remote Stop outside the committed transaction', async () => {
		const provider = controlledResponse();
		let providerSignal: AbortSignal | undefined;
		fetch.mockImplementationOnce(async (_url, init) => {
			providerSignal = init?.signal ?? undefined;
			providerSignal?.addEventListener('abort', () => provider.abort(providerSignal!.reason), { once: true });
			return provider.response;
		});
		let conversationId: string | undefined;
		let settled = false;
		const work = new StreamingAgent({ user: 'viewer', scope: 'team' }).stream('Wait quietly', event => {
			if (event.type === 'conversation.created') conversationId = event.conversationId;
		}).then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
		const remote = new AgentConversations(application.ai, { enabled: true, authorizeStop: context => context.userId === 'viewer' });
		try {
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			// Real SQL and a real timer exercise the AsyncLocalStorage boundary. A
			// timer inherited from admission would query its committed transaction.
			await new Promise(resolve => setTimeout(resolve, 5250));
			expect(settled).toBe(false);
			expect(providerSignal?.aborted).toBe(false);
			await remote.stop(reader, { conversationId: conversationId! });
			await vi.waitFor(() => expect(settled).toBe(true), { timeout: 6000 });
			expect(await work).toEqual({ result: null });
			expect(providerSignal?.aborted).toBe(true);
			expect((await AiConversation.findOrFail(conversationId!)).streamState?.run.status).toBe('cancelled');
		} finally { provider.finish('Finished'); await work; await remote.drain(); }
	}, 20_000);

	it('rejects a saved output after remote Stop without waiting for the next poll', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValueOnce(provider.response);
		let conversationId: string | undefined;
		const work = new StreamingAgent({ user: 'viewer', scope: 'team' }).stream('Wait for output', event => {
			if (event.type === 'conversation.created') conversationId = event.conversationId;
		});
		const remote = new AgentConversations(application.ai, { enabled: true, authorizeStop: context => context.userId === 'viewer' });
		try {
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			await remote.stop(reader, { conversationId: conversationId! });
			provider.finish('This must not be saved.');
			await expect(work).resolves.toBeNull();
			expect(await AiMessage.where('conversation', conversationId!).where('role', 'assistant').count()).toBe(0);
			expect((await AiConversation.findOrFail(conversationId!)).streamState?.run.status).toBe('cancelled');
		} finally { provider.finish('Finished'); await work; await remote.drain(); }
	}, 4000);

	it('does not signal or persist a stop rolled back by the caller', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First');
		const notified = vi.fn(); const unsubscribe = application.ai.conversations.onStop(first.aiRequestId!, notified);
		try {
			await expect(database.db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
				await application.ai.conversations.stop(reader, { conversationId: first.conversationId });
				throw new Error('rollback');
			}))).rejects.toThrow('rollback');
			expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run.status).toBe('queued');
			expect(notified).not.toHaveBeenCalled();
		} finally { unsubscribe(); }
	});

	it('publishes transient output without SQL deltas and saves its canonical final identity', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Hello', { queue: 'stream-test' });
		const work = application.queue.workNextJob('stream-test');
		try {
			provider.delta('Hello ');
			await vi.waitFor(async () => { await application.ai.conversations.drain(); expect(published.some(frame => frame.data.event.type === 'text.delta')).toBe(true); });
			const partialId = published.find(frame => frame.data.event.type === 'text.delta')!.data.itemId;
			const running = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
			expect(running.run?.status).toBe('running'); expect(running.activity?.code).toBe('thinking');
			expect(await AiMessage.where('conversation', queued.conversationId).where('role', 'assistant').count()).toBe(0);
			expect(await database.db.schema.hasTable('ai_stream_events')).toBe(false);
			provider.delta('world.'); provider.finish('Hello world.');
			expect((await work)?.status).toBe('succeeded');
			const saved = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
			expect(saved.timeline.filter(item => item.kind === 'message' && item.role === 'assistant')).toEqual([expect.objectContaining({ id: partialId, content: 'Hello world.' })]);
			expect(saved.run?.status).toBe('completed'); expect(fetch).toHaveBeenCalledOnce();
		} finally { provider.finish('Hello world.'); await work; }
	});

	it('records a real queued tool call and progress while no browser owns the tool loop', async () => {
		let finishTool!: () => void;
		const toolFinished = new Promise<void>(resolve => { finishTool = resolve; });
		/** Exercises the normal SDK tool bridge with an independently controlled completion. */
		class ToolStreamingAgent extends StreamingAgent {
			/** Runs application work in the worker and persists its existing progress events. */
			protected override tools() {
				return [Object.assign(tool({ name: 'inspect_topic', description: 'Inspect the topic.', parameters: z.object({ topic: z.string() }),
					/** Reports progress before waiting for the deterministic tool boundary. */
					execute: async (input, context, details) => {
						await emitAgentToolProgress({ runContext: context as RunContext<AgentRunContext>, details, toolName: 'inspect_topic', message: 'Reading source material', current: 1, total: 2 });
						await toolFinished;
						return agentToolOutputWithModelAttachments({ status: 'success', topic: input.topic, summary: 'A practical outline.', screenshot: { url: '/media/screenshot.png' } }, [{ type: 'image', image: { data: 'aW1hZ2U=', mediaType: 'image/png' } }]);
					},
				}), { title: 'Inspect topic' })];
			}
		}
		registerQueuedAgent('ToolStreamingAgent', ToolStreamingAgent);
		const call = { type: 'function_call', id: 'fc_inspect', call_id: 'call_inspect', name: 'inspect_topic', arguments: '{"topic":"workshops"}' };
		const response = { id: 'resp_tool', object: 'response', model: 'test-model', created_at: 1, status: 'completed', output: [call], usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
		const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: call }, { type: 'response.output_item.done', output_index: 0, item: call }, { type: 'response.completed', response }];
		const final = controlledResponse(); final.delta('Finished'); final.finish('Finished');
		fetch.mockResolvedValueOnce(new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })).mockResolvedValueOnce(final.response);
		const queued = await new ToolStreamingAgent({ user: 'viewer', scope: 'team' }).queue('Inspect workshops', { queue: 'tool-stream' });
		const work = application.queue.workNextJob('tool-stream');
		try {
			await vi.waitFor(async () => {
				const snapshot = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
				expect(snapshot.timeline.find(item => item.kind === 'tool')).toMatchObject({ id: 'call_inspect', state: 'calling', arguments: { topic: 'workshops' } });
			}, { timeout: 5000 });
			finishTool(); expect((await work)?.status).toBe('succeeded');
			const reopened = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
			expect(reopened.timeline.filter(item => item.kind === 'tool')).toEqual([expect.objectContaining({ state: 'success', arguments: { topic: 'workshops' }, result: expect.objectContaining({ topic: 'workshops' }) })]);
			const result = await AiMessage.where('conversation', queued.conversationId).where('toolCallId', 'call_inspect').where('toolState', 'success').firstOrFail();
			expect(result.contentJson).toMatchObject({ result: { screenshot: { url: '/media/screenshot.png' } } });
			expect(JSON.stringify(result.contentJson)).not.toContain('aW1hZ2U=');
			for (const before of [result.sequence! + 1, result.sequence!]) {
				const page = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin', before, limit: 1 });
				expect(page.timeline.find(item => item.kind === 'tool')).toMatchObject({ state: 'success', arguments: { topic: 'workshops' }, result: expect.objectContaining({ topic: 'workshops' }) });
			}
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally { finishTool(); await work; }
	});

	it('publishes independent tool outcomes before their parallel batch finishes', async () => {
		const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
		const names = ['lookup_record', 'check_permission', 'wait_for_report'];
		/** Uses ordinary tools with no completion callbacks or custom progress code. */
		class ParallelToolsAgent extends StreamingAgent {
			/** Allows the synthetic provider to group independent function calls. */
			protected override modelSettings() { return { ...super.modelSettings(), parallelToolCalls: true }; }
			/** Returns independently controlled success/error outcomes through the common SDK bridge. */
			protected override tools() {
				return names.map((name, index) => Object.assign(tool({ name, description: name, parameters: z.object({}),
					/** Waits only on this tool's gate; another tool must not delay its saved result. */
					execute: async () => { await gates[index]!.promise; return index === 1 ? { status: 'error', message: 'Permission denied.' } : { status: 'success', result: name }; },
				}), { title: name }));
			}
		}
		registerQueuedAgent('ParallelToolsAgent', ParallelToolsAgent);
		const calls = names.map((name, index) => ({ type: 'function_call', id: `fc_parallel_${index}`, call_id: `call_parallel_${index}`, name, arguments: '{}' }));
		const response = { id: 'resp_parallel', object: 'response', model: 'test-model', created_at: 1, status: 'completed', output: calls, usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } };
		const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, ...calls.flatMap((item, output_index) => [{ type: 'response.output_item.added', output_index, item }, { type: 'response.output_item.done', output_index, item }]), { type: 'response.completed', response }];
		const final = controlledResponse(); final.finish('Finished');
		fetch.mockResolvedValueOnce(new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })).mockResolvedValueOnce(final.response);
		const queued = await new ParallelToolsAgent({ user: 'viewer', scope: 'team' }).queue('Inspect', { queue: 'parallel-tools' });
		const work = application.queue.workNextJob('parallel-tools');
		try {
			await vi.waitFor(async () => expect(await AiMessage.where('conversation', queued.conversationId).where('role', 'tool').where('toolState', 'calling').count()).toBe(3));
			for (const index of [2, 1]) {
				gates[index]!.resolve();
				const state = index === 1 ? 'error' : 'success';
				await vi.waitFor(async () => {
					const snapshot = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
					expect(snapshot.timeline.find(item => item.id === `call_parallel_${index}`)).toMatchObject({ state });
					expect(snapshot.timeline.find(item => item.id === 'call_parallel_0')).toMatchObject({ state: 'calling' });
					expect(snapshot.activity?.code).toBe('tool');
				});
				await application.ai.conversations.drain();
				expect(published.some(frame => JSON.stringify(frame).includes(`call_parallel_${index}`) && JSON.stringify(frame).includes(`"state":"${state}"`))).toBe(true);
				expect(fetch).toHaveBeenCalledOnce();
			}
			gates[0]!.resolve();
			expect((await work)?.status).toBe('succeeded');
			for (const [index] of names.entries()) expect(await AiMessage.where('conversation', queued.conversationId).where('toolCallId', `call_parallel_${index}`).whereIn('toolState', ['success', 'error']).count()).toBe(1);
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally { for (const gate of gates) gate.resolve(); await work; }
	});

	it('records a tool result despite a concurrent update to its referenced request without replaying work', async () => {
		const conversation = await AiConversation.create({ user: 'viewer', scope: 'team' }).save();
		const request = await AiRequest.create({ conversation, user: 'viewer', scope: 'team', operation: 'agents.run.queue', request: {} }).save();
		const state: AgentPersistenceState = { conversation, rootAiRequest: request, aiRequest: request, nextSequence: 1, model: 'test-model', traceId: 'trace_fk_race', startTimeMs: Date.now(), metadata: {}, toolDefinitions: [], hostedToolUsage: {}, hostedToolCallIds: new Set(), citations: [], toolArgumentsByCallId: {} };
		const recorder = new AgentStreamRecorder(state);
		let writes = 0;
		try {
			await recorder.begin('running');
			await recorder.message(state, { role: 'tool', contentJson: {}, metadata: { eventType: 'tool_success' } }, async () => {
				// The recorder has read message order. A real second connection now
				// commits a parent update before the insert's foreign-key check.
				await database.db('ai_requests').where('id', request.id).update({ metadata: JSON.stringify({ observed: true }) });
				writes++;
				return AiMessage.create({ conversation, aiRequest: request, role: 'tool', sequence: state.nextSequence, toolCallId: 'call_race', toolName: 'lookup_record', toolState: 'success', contentJson: { state: 'success', result: { saved: true } } }).save();
			});
			expect(writes).toBe(1);
			expect(await AiMessage.where('conversation', conversation.id).count()).toBe(1);
			const snapshot = await application.ai.conversations.load(reader, { conversationId: String(conversation.id), view: 'admin' });
			expect(snapshot.timeline.find(item => item.id === 'call_race')).toMatchObject({ state: 'success', result: { saved: true } });
		} finally { await recorder.close().catch(() => undefined); }
	});

	it('finishes with an unavailable socket relay and refresh recovers saved output without replay', async () => {
		available = false;
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Finish while offline', { queue: 'relay-failure' });
		provider.delta('Complete'); provider.finish('Complete');
		expect((await application.queue.workNextJob('relay-failure'))?.status).toBe('succeeded');
		await application.ai.conversations.drain(); available = true;
		const saved = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'conversation' });
		expect(saved.run?.status).toBe('completed');
		expect(saved.timeline).toContainEqual(expect.objectContaining({ content: 'Complete' }));
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('rejects a superseded writer before it can persist later output', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('One owner', { queue: 'writer-fence' });
		const work = application.queue.workNextJob('writer-fence');
		try {
			provider.delta('Owned');
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			const saved = await AiConversation.findOrFail(queued.conversationId);
			await AiConversation.where('id', saved.id).patch({ streamState: { ...saved.streamState!, owner: 'replacement-writer' } });
			provider.delta(' must not save'); provider.finish('Owned must not save');
			await work;
			expect((await AiMessage.where('conversation', queued.conversationId).where('role', 'assistant').all()).map(message => message.content)).toEqual([]);
			expect(fetch).toHaveBeenCalledTimes(1);
		} finally { provider.finish('Owned'); await work; }
	});

	it('paginates full saved items without hiding tools behind large-payload placeholders', async () => {
		const conversation = await AiConversation.create({ user: 'viewer', scope: 'team' }).save();
		for (let sequence = 1; sequence <= 45; sequence++) await AiMessage.create({ conversation, role: 'assistant', sequence, content: sequence === 45 ? 'Large output '.repeat(1000) : `Message ${sequence}` }).save();
		const input = { conversationId: String(conversation.id), view: 'admin' as const };
		const snapshot = await application.ai.conversations.load(reader, input);
		expect(snapshot.timeline).toHaveLength(40); expect(snapshot.older).toBe(6);
		expect(snapshot.timeline.at(-1)).toMatchObject({ kind: 'message', content: 'Large output '.repeat(1000) });
		expect((await application.ai.conversations.load(reader, { ...input, before: snapshot.older! })).timeline).toHaveLength(5);
	});

	it('preserves finalized provider output when completing the root fails, then settles without another request', async () => {
		const activations: boolean[] = [];
		/** Restores application policy for both provider work and settlement-only retry. */
		class SettlementAgent extends StreamingAgent {
			/** Observes the durable checkpoint without creating another provider call. */
			protected override async beforeQueuedRun(root: AiRequest): Promise<void> { activations.push((root.response as { providerFinalized?: boolean } | null)?.providerFinalized === true); }
		}
		registerQueuedAgent('SettlementAgent', SettlementAgent);
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new SettlementAgent({ user: 'viewer', scope: 'team' }).queue('Finish once', { queue: 'settlement', maxTries: 2, backoff: { initialSeconds: 0 } });
		await database.db.raw("CREATE TRIGGER stream_settlement_failure BEFORE UPDATE ON ai_requests FOR EACH ROW BEGIN IF NEW.operation = 'agents.run.queue' AND NEW.status = 'completed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic settlement storage failure'; END IF; END");
		try {
			provider.delta('Done'); provider.finish('Done');
			await application.queue.workNextJob('settlement');
			const root = await AiRequest.findOrFail(queued.aiRequestId!);
			expect(root.response).toMatchObject({ providerFinalized: true, finalOutput: 'Done' });
			expect((await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' })).run).toMatchObject({ status: 'waiting', attempt: 1 });
			expect(root.status).toBe('pending');
		} finally { await database.db.raw('DROP TRIGGER stream_settlement_failure'); }
		await QueuedJob.query().patch({ availableAt: 0 });
		expect((await application.queue.workNextJob('settlement'))?.status).toBe('succeeded');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(activations).toEqual([false, true]);
		expect((await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' })).run?.status).toBe('completed');
	});

	it('fences delayed retry notifications from newer attempts and stopped turns', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Hello');
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 2);
		const state = (await AiConversation.findOrFail(queued.conversationId)).streamState;
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 1);
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 2);
		expect((await AiConversation.findOrFail(queued.conversationId)).streamState).toEqual(state);
		await application.ai.conversations.stop(reader, { conversationId: queued.conversationId });
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 3);
		expect((await AiConversation.findOrFail(queued.conversationId)).streamState?.run.status).toBe('cancelled');
	});

	it('denies unknown users and mismatched scope and keeps status delivery free of transcript', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('PRIVATE task');
		await expect(application.ai.conversations.load({ userId: 'stranger' }, { conversationId: queued.conversationId, view: 'admin' })).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.load({ ...reader, scopeId: 'another-team' }, { conversationId: queued.conversationId, view: 'admin' })).rejects.toMatchObject({ statusCode: 404 });
		const snapshot = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'status' });
		expect(snapshot.timeline).toEqual([]);
		await application.ai.conversations.drain();
		expect(JSON.stringify(published.filter(frame => frame.data.view === 'status'))).not.toContain('PRIVATE');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('does not mark an active saved tool as interrupted', async () => {
		const message = AiMessage.create({ id: 'tool-message', aiRequest: 'root', role: 'tool', toolCallId: 'call_1', toolName: 'research', toolState: 'calling', contentJson: { arguments: {} }, metadata: { streamProgress: [{ id: 'progress', message: 'Reading', createdAt: new Date().toISOString() }] } });
		expect(agentConversationTimeline([message], [], [], { activeRequestId: 'root' })[0]).toMatchObject({ state: 'calling', progressUpdates: [expect.objectContaining({ message: 'Reading' })] });
		expect(agentConversationTimeline([message])[0]).toMatchObject({ state: 'error' });
	});


	it('deduplicates concurrent admission and rejects changed input without creating another run', async () => {
		const admit = () => new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('One turn', { idempotencyKey: 'send-1' });
		const [first, second] = await Promise.all([admit(), admit()]);
		expect(second).toEqual(first);
		await expect(new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Changed', { idempotencyKey: 'send-1' })).rejects.toMatchObject({ statusCode: 409 });
		expect(await AiConversation.query().count()).toBe(1);
		expect(await AiRequest.query().count()).toBe(1);
		expect(await QueuedJob.query().count()).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('commits request preparation before dispatch and returns the acknowledged delivery id', async () => {
		let insideTransaction: boolean | undefined;
		let savedInputs = 0;
		const unsubscribe = application.queue.events.subscribe(async event => {
			if (event.action !== 'dispatched' || event.queue !== 'acknowledged') return;
			insideTransaction = ActiveRecord.getScopedDb()?.isTransaction ?? false;
			savedInputs = await AiMessage.where('role', 'user').count();
		});
		try {
			const accepted = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Saved first', { queue: 'acknowledged', idempotencyKey: 'receipt' });
			expect(insideTransaction).toBe(false);
			expect(savedInputs).toBe(1);
			expect((await QueuedJob.findOrFail(accepted.jobId)).payload.data).toMatchObject({ aiRequestId: accepted.aiRequestId });
			expect((await AiRequest.findOrFail(accepted.aiRequestId!)).request).toMatchObject({ queueJobId: accepted.jobId });
			expect(fetch).not.toHaveBeenCalled();
		} finally { unsubscribe(); }
	});

	it('retains failed dispatches and removes only their pending followup from the conversation', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Original turn');
		const before = (await AiConversation.findOrFail(first.conversationId)).streamState;
		await database.db.raw("CREATE TRIGGER reject_agent_dispatch BEFORE INSERT ON jobs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic queue outage'");
		try {
			await expect(new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Followup rejected', { idempotencyKey: 'rejected' })).rejects.toThrow('Synthetic queue outage');
		} finally { await database.db.raw('DROP TRIGGER reject_agent_dispatch'); }
		const failed = await AiRequest.where('status', 'failed').firstOrFail();
		expect(failed.errorCode).toBe('queue_dispatch_failed');
		expect(failed.request).not.toHaveProperty('queueJobId');
		expect(await AiMessage.where('aiRequest', failed.id).where('role', 'user').count()).toBe(1);
		expect((await AiConversation.findOrFail(first.conversationId)).streamState).toMatchObject({ run: before!.run, pending: [] });
		await expect(new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Followup rejected', { idempotencyKey: 'rejected' })).rejects.toMatchObject({ statusCode: 409 });
		expect(await QueuedJob.query().count()).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('retains a rejected initial request as failed rather than advertising nonexistent queued work', async () => {
		await database.db.raw("CREATE TRIGGER reject_initial_agent_dispatch BEFORE INSERT ON jobs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Initial queue outage'");
		try {
			await expect(new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Rejected initial turn', { idempotencyKey: 'initial-rejected' })).rejects.toThrow('Initial queue outage');
		} finally { await database.db.raw('DROP TRIGGER reject_initial_agent_dispatch'); }
		expect(await QueuedJob.query().count()).toBe(0);
		const failed = await AiRequest.query().firstOrFail();
		expect(failed).toMatchObject({ status: 'failed', errorCode: 'queue_dispatch_failed' });
		expect((await AiConversation.findOrFail(failed.conversation!.id)).streamState?.run.status).toBe('failed');
		const accepted = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Try deliberately again', { idempotencyKey: 'new-send' });
		expect(accepted.jobId).toBeDefined();
		expect(await AiRequest.query().count()).toBe(2);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('preserves completed output and prompt data when a worker executes before dispatch returns', async () => {
		const provider = controlledResponse(); provider.finish('Fast answer'); fetch.mockResolvedValueOnce(provider.response);
		let execution: import('@db3.ai/app/queue').QueueProcessResult | null = null;
		const unsubscribe = application.queue.events.subscribe(async event => {
			if (event.action === 'dispatched' && event.queue === 'fast-worker') execution = await application.queue.workNextJob('fast-worker');
		});
		try {
			const accepted = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Fast input', { queue: 'fast-worker', idempotencyKey: 'fast' });
			expect(execution).toMatchObject({ status: 'succeeded' });
			const request = await AiRequest.findOrFail(accepted.aiRequestId!);
			expect(request).toMatchObject({ status: 'completed', request: { queueJobId: accepted.jobId, instructions: 'Answer briefly.' }, response: { finalOutput: 'Fast answer' }, metadata: { queueJobId: accepted.jobId } });
			expect(await QueuedJob.query().count()).toBe(0);
			expect(await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Fast input', { queue: 'fast-worker', idempotencyKey: 'fast' })).toEqual(accepted);
			expect(fetch).toHaveBeenCalledOnce();
		} finally { unsubscribe(); }
	});

	it('rejects direct concurrent execution atomically without leaving an orphan pending request', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('One turn');
		const messages = await AiMessage.query().count();
		const errors: string[] = [];
		await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).stream('Another', event => { if (event.type === 'run.error') errors.push(event.error.message); });
		expect(errors).toEqual(['This conversation already has an active turn.']);
		expect(await AiRequest.query().count()).toBe(1); expect(await AiMessage.query().count()).toBe(messages); expect(await QueuedJob.query().count()).toBe(1);
	});

	it('rolls admission records back with a caller transaction and never calls the provider', async () => {
		await expect(database.db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Rolled back');
			throw new Error('rollback');
		}))).rejects.toThrow('rollback');
		expect(await AiMessage.query().count()).toBe(0);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('queues followups in order, refreshes provider history and cancels remaining queued input', async () => {
		const firstProvider = controlledResponse();
		fetch.mockResolvedValueOnce(firstProvider.response);
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First input', { queue: 'first-turn' });
		const work = application.queue.workNextJob('first-turn');
		try {
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			const second = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Second input', { queue: 'second-turn', idempotencyKey: 'second' });
			const third = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Third input', { queue: 'third-turn' });
			const snapshot = await application.ai.conversations.load(reader, { conversationId: first.conversationId, view: 'conversation' });
			expect(snapshot).toMatchObject({ queued: 2, run: { aiRequestId: first.aiRequestId, status: 'running' } });
			expect((await application.queue.workNextJob('second-turn'))?.status).toBe('deferred');
			expect(fetch).toHaveBeenCalledOnce();
			firstProvider.finish('First saved answer'); expect((await work)?.status).toBe('succeeded');
			expect((await application.queue.workNextJob('third-turn'))?.status).toBe('deferred');
			const final = controlledResponse(); final.finish('Second saved answer'); fetch.mockResolvedValueOnce(final.response);
			await QueuedJob.query().patch({ availableAt: 0 });
			expect((await application.queue.workNextJob('second-turn'))?.status).toBe('succeeded');
			const body = String(fetch.mock.calls[1]![1]?.body);
			expect(body).toContain('First saved answer'); expect(body).toContain('Second input'); expect(body).not.toContain('Third input');
			expect((await AiRequest.findOrFail(second.aiRequestId!)).status).toBe('completed');
			const thirdProvider = controlledResponse(); thirdProvider.finish('Third saved answer'); fetch.mockResolvedValueOnce(thirdProvider.response);
			await QueuedJob.query().patch({ availableAt: 0 });
			expect((await application.queue.workNextJob('third-turn'))?.status).toBe('succeeded');
			const thirdInput = JSON.parse(String(fetch.mock.calls[2]![1]?.body)).input;
			const ordered = JSON.stringify(thirdInput);
			expect(ordered.indexOf('First saved answer')).toBeLessThan(ordered.indexOf('Second input'));
			expect(ordered.indexOf('Second input')).toBeLessThan(ordered.indexOf('Second saved answer'));
			const fourth = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Fourth input', { queue: 'fourth-turn' });
			await application.ai.conversations.stop(reader, { conversationId: first.conversationId });
			expect((await AiRequest.findOrFail(fourth.aiRequestId!)).errorCode).toBe('agent_cancelled');
			expect((await application.queue.workNextJob('fourth-turn'))?.status).toBe('failed');
			expect(fetch).toHaveBeenCalledTimes(3);
		} finally { firstProvider.finish('First saved answer'); await work; }
	});

	it('restores provider reasoning summaries from real SDK events without duplicating ordinary text', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValueOnce(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Explain', { queue: 'reasoning' });
		provider.reasoning('Checking the useful evidence.'); provider.delta('Answer.'); provider.finish('Answer.');
		expect((await application.queue.workNextJob('reasoning'))?.status).toBe('succeeded');
		await application.ai.conversations.drain();
		const saved = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'conversation' });
		expect(saved.timeline).toContainEqual(expect.objectContaining({ kind: 'reasoning_summary', text: 'Checking the useful evidence.' }));
		const text = published.filter(frame => frame.data.view === 'conversation' && frame.data.event.type === 'text.delta').map(frame => (frame.data.event as { delta: string }).delta).join('');
		expect(text).toBe('Answer.');
		expect(published.some(frame => frame.data.view === 'conversation' && frame.data.event.type === 'reasoning.summary.delta')).toBe(true);
	});

	it('normalizes already saved screenshot attachment arrays when reopening history', () => {
		const result = { status: 'success' as const, screenshot: { url: '/media/existing.png' } };
		const output = agentToolOutputWithModelAttachments(result, [{ type: 'image', image: { data: 'aW1hZ2U=', mediaType: 'image/png' } }]);
		for (const legacy of [output, JSON.stringify(output)]) {
			const message = AiMessage.create({ id: 'saved-screenshot', role: 'tool', toolCallId: 'screenshot-call', toolName: 'website_screenshot', toolState: 'success', contentJson: { result: legacy, state: 'success' } });
			expect(agentConversationTimeline([message])[0]).toMatchObject({ kind: 'tool', state: 'success', result });
		}
	});

	it('repairs only demonstrably unadmitted legacy roots without changing the real owner', async () => {
		const run = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Actual turn');
		const conversation = await AiConversation.findOrFail(run.conversationId);
		const owner = conversation.streamState;
		const orphan = await AiRequest.create({ conversation, request: {}, operation: 'agents.run.stream', status: 'pending', metadata: { transport: 'ndjson' } }).save();
		await AiMessage.create({ conversation, aiRequest: orphan, role: 'system', sequence: 3, content: 'Instructions', metadata: { eventType: 'system_instructions' } }).save();
		const admitted = await AiRequest.create({ conversation, request: {}, operation: 'agents.run.stream', status: 'pending', metadata: { transport: 'ndjson' } }).save();
		await AiMessage.create({ conversation, aiRequest: admitted, role: 'user', sequence: 4, content: 'Already admitted' }).save();
		expect(await application.ai.conversations.repairRejectedRequests(run.conversationId)).toBe(1);
		expect((await AiRequest.findOrFail(orphan.id)).errorCode).toBe('agent_admission_rejected');
		expect((await AiRequest.findOrFail(admitted.id)).status).toBe('pending');
		expect((await AiConversation.findOrFail(run.conversationId)).streamState).toEqual(owner);
		expect(await application.ai.conversations.repairRejectedRequests(run.conversationId)).toBe(0);
	});

	it('keeps retry ownership while a released queue callback is delayed', async () => {
		const released = Promise.withResolvers<void>(); const resume = Promise.withResolvers<void>();
		/** Delays only the real queue lifecycle callback, exposing the ownership race. */
		class DelayedRetryJob extends AgentRunJob {
			static override jobName = 'AgentRunJob';
			/** Holds the release notification while another worker attempts a followup. */
			override async onRetry(context: import('@db3.ai/app/queue').QueueableJobRetryContext): Promise<void> { released.resolve(); await resume.promise; await super.onRetry(context); }
		}
		application.queue.registerJob(DelayedRetryJob);
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Invalid synthetic request', type: 'invalid_request_error', code: 'invalid_request' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'retry-first', maxTries: 2, backoff: { initialSeconds: 0 } });
		await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Followup', { queue: 'retry-followup' });
		const work = application.queue.workNextJob('retry-first');
		try {
			await released.promise;
			expect((await application.queue.workNextJob('retry-followup'))?.status).toBe('deferred');
			expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run).toMatchObject({ aiRequestId: first.aiRequestId, status: 'waiting' });
			expect(fetch).toHaveBeenCalledOnce();
			resume.resolve(); await work;
			const provider = controlledResponse(); provider.finish('Recovered'); fetch.mockResolvedValueOnce(provider.response);
			await QueuedJob.query().patch({ availableAt: 0 });
			expect((await application.queue.workNextJob('retry-first'))?.status).toBe('succeeded');
		} finally { resume.resolve(); await work; application.queue.registerJob(AgentRunJob); }
	});

	it('fences finalization after Stop and refuses a stale delivery even with an old pending root', async () => {
		const conversation = await AiConversation.create({ user: 'viewer', scope: 'team' }).save();
		const request = await AiRequest.create({ conversation, user: 'viewer', scope: 'team', operation: 'agents.run.queue', request: {} }).save();
		const state: AgentPersistenceState = { conversation, rootAiRequest: request, aiRequest: request, nextSequence: 1, model: 'test-model', traceId: 'trace_stop_race', startTimeMs: Date.now(), metadata: {}, toolDefinitions: [], hostedToolUsage: {}, hostedToolCallIds: new Set(), citations: [], toolArgumentsByCallId: {} };
		const recorder = new AgentStreamRecorder(state);
		try {
			await recorder.begin('running');
			await application.ai.conversations.stop(reader, { conversationId: String(conversation.id) });
			request.assign({ status: 'pending', errorCode: null, response: { providerFinalized: true } });
			await expect(recorder.checkpoint(() => request.save())).rejects.toThrow();
			expect((await AiRequest.findOrFail(request.id)).errorCode).toBe('agent_cancelled');
			// A stale pre-upgrade handler may already have overwritten the root; the conversation fence still wins.
			await AiRequest.where('id', request.id).patch({ status: 'pending', errorCode: null });
			const duplicate = new AgentStreamRecorder(state);
			try { await expect(duplicate.begin('running')).rejects.toThrow('already ended'); } finally { await duplicate.close(); }
			expect((await AiConversation.findOrFail(conversation.id)).streamState?.run.status).toBe('cancelled');
		} finally { await recorder.close(); }
	});

	it('persists hosted tool starts before the provider finishes the search', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValueOnce(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Search', { queue: 'hosted' });
		const work = application.queue.workNextJob('hosted');
		try {
			provider.hostedStart();
			await vi.waitFor(async () => {
				const saved = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'conversation' });
				expect(saved.timeline.find(item => item.kind === 'tool')).toMatchObject({ state: 'calling', toolName: 'web_search_call' });
				expect(saved.activity?.code).toBe('tool');
			});
			provider.hostedFinish(); provider.finish('Found');
			expect((await work)?.status).toBe('succeeded');
			const saved = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'conversation' });
			expect(saved.timeline.find(item => item.kind === 'tool')).toMatchObject({ state: 'success' });
		} finally { provider.finish('Found'); await work; }
	});

});
