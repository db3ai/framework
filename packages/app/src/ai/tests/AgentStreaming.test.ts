import { AgentStreamRecorder } from '../AgentStreamRecorder';
import type { AgentPersistenceState } from '../contracts/Agent';
import { z } from 'zod';
import type { RunContext } from '@openai/agents';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { ActiveRecord } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Agent, AgentConversations, AgentRunJob, AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, AiStreamEvent, registerQueuedAgent, agentConversationTimeline, tool, emitAgentToolProgress, type AgentRunContext, type AgentTool } from '@db3.ai/app/ai';
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
const published: Array<{ data: { events?: Array<{ event: { type: string; run?: { status: string } } }> } }> = [];
const reader = { userId: 'viewer', scopeId: 'team' };

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
		if (available) published.push(JSON.parse(Buffer.concat(chunks).toString()));
		response.writeHead(available ? 200 : 503).end();
	});
	await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
	const port = (receiver.address() as { port: number }).port;
	database = await createGeneratedTestDatabase('agent_stream');
	application = new App({ db: database.db, webSockets: { publish: { url: `http://127.0.0.1:${port}/publish`, token: 'x'.repeat(64) } }, ai: { apiKey: 'synthetic-test-key', model: 'test-model', rateLimiter: false, fetch, streaming: { enabled: true, flushIntervalMs: 5, authorize: context => context.userId === 'viewer', authorizeStop: (context, conversation) => context.userId === conversation.user } }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, AiStreamEvent, QueuedJob, FailedJob);
	application.queue.registerJob(AgentRunJob);
	registerQueuedAgent('StreamingAgent', StreamingAgent);
});
beforeEach(async () => {
	await application.ai.conversations.drain();
	fetch.mockReset(); available = true; published.length = 0;
	for (const Model of [AiStreamEvent, AiMessage, AiRequest, AiRateLimitReservation, AiRateLimitBucket, QueuedJob, FailedJob, AiConversation]) await Model.query().delete();
});
afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); await new Promise<void>(resolve => receiver?.close(() => resolve())); vi.unstubAllEnvs(); } });

describe('durable agent streaming', () => {
	it('cancels a queued turn idempotently, rejects unauthorized controls, and fences old delivery after a new turn', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'stop-test' });
		const input = { conversationId: first.conversationId, aiRequestId: first.aiRequestId! };
		await expect(application.ai.conversations.stop({ userId: 'stranger' }, input)).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.stop({ ...reader, scopeId: 'wrong' }, input)).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.stop(reader, input)).resolves.toMatchObject({ status: 'cancelled' });
		const sequence = (await AiConversation.findOrFail(first.conversationId)).streamSequence;
		await expect(application.ai.conversations.stop(reader, input)).resolves.toMatchObject({ status: 'cancelled' });
		expect((await AiConversation.findOrFail(first.conversationId)).streamSequence).toBe(sequence);
		const second = await new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Continue', { queue: 'stop-test' });
		await expect(application.ai.conversations.stop(reader, input)).rejects.toMatchObject({ statusCode: 409 });
		expect((await application.queue.workNextJob('stop-test'))?.status).toBe('failed');
		expect(fetch).not.toHaveBeenCalled();
		expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run).toMatchObject({ aiRequestId: second.aiRequestId, status: 'queued' });
		const provider = controlledResponse(); provider.finish('Continued.'); fetch.mockResolvedValueOnce(provider.response);
		expect((await application.queue.workNextJob('stop-test'))?.status).toBe('succeeded');
		await expect(application.ai.conversations.stop(reader, { ...input, aiRequestId: second.aiRequestId! })).resolves.toMatchObject({ status: 'completed' });
	});

	it('stops a running provider, retains partial output, and leaves a sibling run unaffected', async () => {
		const provider = controlledResponse();
		let providerSignal: AbortSignal | undefined;
		fetch.mockImplementationOnce(async (_url, init) => { providerSignal = init?.signal ?? undefined; providerSignal?.addEventListener('abort', () => provider.abort(providerSignal!.reason), { once: true }); return provider.response; });
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First', { queue: 'stop-running' });
		const sibling = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Sibling', { queue: 'sibling' });
		const work = application.queue.workNextJob('stop-running');
		try {
			provider.delta('Keep this partial.');
			await vi.waitFor(async () => expect(await AiMessage.where('conversation', first.conversationId).where('content', 'Keep this partial.').count()).toBe(1));
			await application.ai.conversations.stop(reader, { conversationId: first.conversationId, aiRequestId: first.aiRequestId! });
			expect((await work)?.status).toBe('failed');
			expect(providerSignal?.aborted).toBe(true);
			const saved = await application.ai.conversations.load(reader, { conversationId: first.conversationId, view: 'admin' });
			expect(saved.run).toMatchObject({ status: 'cancelled', error: null });
			expect(saved.timeline).toContainEqual(expect.objectContaining({ content: 'Keep this partial.', streaming: false }));
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
			await remote.stop(reader, { conversationId: first.conversationId, aiRequestId: first.aiRequestId! });
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

	it('does not signal or persist a stop rolled back by the caller', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('First');
		const notified = vi.fn(); const unsubscribe = application.ai.conversations.onStop(first.aiRequestId!, notified);
		try {
			await expect(database.db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
				await application.ai.conversations.stop(reader, { conversationId: first.conversationId, aiRequestId: first.aiRequestId! });
				throw new Error('rollback');
			}))).rejects.toThrow('rollback');
			expect((await AiConversation.findOrFail(first.conversationId)).streamState?.run.status).toBe('queued');
			expect(notified).not.toHaveBeenCalled();
		} finally { unsubscribe(); }
	});

	it('records partial output without viewers and completes the same message after reattachment', async () => {
		const provider = controlledResponse();
		fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Hello', { queue: 'stream-test' });
		const initial = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
		expect(initial.run?.status).toBe('queued');
		const work = application.queue.workNextJob('stream-test');
		try {
			provider.delta('Hello ');
			let partialId: string | undefined;
			await vi.waitFor(async () => {
				const partial = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
				const output = partial.timeline.find(item => item.kind === 'message' && item.role === 'assistant');
				expect(output).toMatchObject({ content: 'Hello ', streaming: true });
				expect(partial.run?.status).toBe('running');
				partialId = output?.id;
			}, { timeout: 5000, interval: 20 });
			const recovered = await application.ai.conversations.updates(reader, initial.cursor);
			expect(recovered.kind).toBe('updates');
			provider.delta('world.');
			provider.finish('Hello world.');
			expect((await work)?.status).toBe('succeeded');
			const reopened = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
			expect(reopened.timeline.filter(item => item.kind === 'message' && item.role === 'assistant')).toEqual([expect.objectContaining({ id: partialId, content: 'Hello world.', streaming: false })]);
			expect(reopened.run?.status).toBe('completed');
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(await AiRequest.query().count()).toBe(2);
		} finally { provider.finish('Hello world.'); await work; }
	}, 15000);

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
						return { status: 'success', topic: input.topic, summary: 'A practical outline.' };
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
				expect(snapshot.timeline.find(item => item.kind === 'tool')).toMatchObject({ id: 'call_inspect', state: 'calling', arguments: { topic: 'workshops' }, progressUpdates: [expect.objectContaining({ message: 'Reading source material' })] });
			}, { timeout: 5000 });
			finishTool(); expect((await work)?.status).toBe('succeeded');
			const reopened = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
			expect(reopened.timeline.filter(item => item.kind === 'tool')).toEqual([expect.objectContaining({ state: 'success', arguments: { topic: 'workshops' }, progressUpdates: [expect.objectContaining({ message: 'Reading source material' })], result: expect.objectContaining({ topic: 'workshops' }) })]);
			const result = await AiMessage.where('conversation', queued.conversationId).where('toolCallId', 'call_inspect').where('toolState', 'success').firstOrFail();
			for (const before of [result.sequence! + 1, result.sequence!]) {
				const page = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin', before, limit: 1 });
				expect(page.timeline.find(item => item.kind === 'tool')).toMatchObject({ state: 'success', arguments: { topic: 'workshops' }, progressUpdates: [expect.objectContaining({ message: 'Reading source material' })], result: expect.objectContaining({ topic: 'workshops' }) });
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

	it('repairs a lost final publication through maintenance without repeating provider work', async () => {
		available = false;
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Finish while the relay is down', { queue: 'relay-failure' });
		provider.delta('Complete'); provider.finish('Complete');
		expect((await application.queue.workNextJob('relay-failure'))?.status).toBe('succeeded');
		await application.ai.conversations.drain();
		let saved = await AiConversation.findOrFail(queued.conversationId);
		expect(saved.streamPublishedSequence).toBeLessThan(saved.streamSequence);
		available = true;
		await application.ai.conversations.publishPending();
		saved = await AiConversation.findOrFail(queued.conversationId);
		expect(saved.streamPublishedSequence).toBe(saved.streamSequence);
		expect(published.some(batch => batch.data.events?.some(entry => entry.event.type === 'run.state' && entry.event.run?.status === 'completed'))).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('rejects a superseded writer before it can persist later output', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('One owner', { queue: 'writer-fence' });
		const work = application.queue.workNextJob('writer-fence');
		try {
			provider.delta('Owned');
			await vi.waitFor(async () => expect(await AiMessage.where('conversation', queued.conversationId).where('content', 'Owned').count()).toBe(1));
			const saved = await AiConversation.findOrFail(queued.conversationId);
			await AiConversation.where('id', saved.id).patch({ streamState: { ...saved.streamState!, owner: 'replacement-writer' } });
			provider.delta(' must not save'); provider.finish('Owned must not save');
			await work;
			expect((await AiMessage.where('conversation', queued.conversationId).where('role', 'assistant').all()).map(message => message.content)).toEqual(['Owned']);
			expect(fetch).toHaveBeenCalledTimes(1);
		} finally { provider.finish('Owned'); await work; }
	});

	it('bounds recent history and reads large items through revision-pinned HTTP chunks', async () => {
		const conversation = await AiConversation.create({ user: 'viewer', scope: 'team' }).save();
		for (let sequence = 1; sequence <= 45; sequence++) await AiMessage.create({ conversation, role: 'assistant', sequence, content: sequence === 45 ? 'Large output '.repeat(1000) : `Message ${sequence}` }).save();
		const input = { conversationId: String(conversation.id), view: 'admin' as const };
		const snapshot = await application.ai.conversations.load(reader, input);
		expect(snapshot.timeline).toHaveLength(40); expect(snapshot.older).toBe(6);
		const reference = snapshot.timeline.at(-1)!;
		expect(reference.kind).toBe('reference');
		if (reference.kind !== 'reference') throw new Error('Expected bounded item');
		const page = await application.ai.conversations.item(reader, { ...input, itemId: reference.key });
		expect(page.content).toHaveLength(4000); expect(page.nextOffset).toBe(4000);
		await AiMessage.where('conversation', conversation.id).where('sequence', 45).patch({ content: 'Changed' });
		await expect(application.ai.conversations.item(reader, { ...input, itemId: reference.key, offset: 4000, revision: page.revision })).rejects.toMatchObject({ statusCode: 409 });
		expect((await application.ai.conversations.load(reader, { ...input, before: snapshot.older! })).timeline).toHaveLength(5);
	});

	it('preserves finalized provider output when completing the root fails, then settles without another request', async () => {
		const provider = controlledResponse(); fetch.mockResolvedValue(provider.response);
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Finish once', { queue: 'settlement', maxTries: 2, backoff: { initialSeconds: 0 } });
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
		expect((await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' })).run?.status).toBe('completed');
	});

	it('fences delayed retry notifications from newer attempts and stopped turns', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Hello');
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 2);
		const sequence = (await AiConversation.findOrFail(queued.conversationId)).streamSequence;
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 1);
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 2);
		expect((await AiConversation.findOrFail(queued.conversationId)).streamSequence).toBe(sequence);
		await application.ai.conversations.stop(reader, { conversationId: queued.conversationId, aiRequestId: queued.aiRequestId! });
		await application.ai.conversations.settleQueuedRetry(queued.aiRequestId!, 3);
		expect((await AiConversation.findOrFail(queued.conversationId)).streamState?.run.status).toBe('cancelled');
	});

	it('denies unknown users and mismatched scope and keeps status replay free of transcript', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('PRIVATE task');
		await expect(application.ai.conversations.load({ userId: 'stranger' }, { conversationId: queued.conversationId, view: 'admin' })).rejects.toMatchObject({ statusCode: 404 });
		await expect(application.ai.conversations.load({ ...reader, scopeId: 'another-team' }, { conversationId: queued.conversationId, view: 'admin' })).rejects.toMatchObject({ statusCode: 404 });
		const snapshot = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'status' });
		expect(snapshot.timeline).toEqual([]);
		const updates = await application.ai.conversations.updates(reader, { ...snapshot.cursor, sequence: 0 });
		expect(JSON.stringify(updates)).not.toContain('PRIVATE');
		expect(updates).toMatchObject({ kind: 'updates', cursor: snapshot.cursor });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('does not mark an active saved tool as interrupted', async () => {
		const message = AiMessage.create({ id: 'tool-message', aiRequest: 'root', role: 'tool', toolCallId: 'call_1', toolName: 'research', toolState: 'calling', contentJson: { arguments: {} }, metadata: { streamProgress: [{ id: 'progress', message: 'Reading', createdAt: new Date().toISOString() }] } });
		expect(agentConversationTimeline([message], [], [], { activeRequestId: 'root' })[0]).toMatchObject({ state: 'calling', progressUpdates: [expect.objectContaining({ message: 'Reading' })] });
		expect(agentConversationTimeline([message])[0]).toMatchObject({ state: 'error' });
	});

	it('requests a new snapshot after journal expiry and rejects cursors beyond committed state', async () => {
		const queued = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Hello');
		const snapshot = await application.ai.conversations.load(reader, { conversationId: queued.conversationId, view: 'admin' });
		await AiStreamEvent.where('conversation', queued.conversationId).delete();
		await expect(application.ai.conversations.updates(reader, { ...snapshot.cursor, sequence: 0 })).resolves.toMatchObject({ kind: 'snapshot_required', reason: 'cursor_expired' });
		await expect(application.ai.conversations.updates(reader, { ...snapshot.cursor, sequence: snapshot.cursor.sequence + 1 })).rejects.toMatchObject({ statusCode: 400 });
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

	it('rejects a second active turn atomically', async () => {
		const first = await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('One turn');
		await expect(new StreamingAgent({ user: 'viewer', scope: 'team', conversationId: first.conversationId }).queue('Another')).rejects.toMatchObject({ statusCode: 409 });
		expect(await AiRequest.query().count()).toBe(1);
		expect(await QueuedJob.query().count()).toBe(1);
	});

	it('rolls admission records back with a caller transaction and never calls the provider', async () => {
		await expect(database.db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			await new StreamingAgent({ user: 'viewer', scope: 'team' }).queue('Rolled back');
			throw new Error('rollback');
		}))).rejects.toThrow('rollback');
		expect(await AiStreamEvent.query().count()).toBe(0);
		expect(await AiMessage.query().count()).toBe(0);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});
});
