import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { App } from '@db3.ai/app/server';
import { Ai, AIRequestError, AIProviderStoppedError, AIProviderDeferredError, Agent, tool, type AgentTool, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, AIRequestTrackingError, AIRateLimitDeferredError, AIRateLimiter, agentConversationTimeline, registerQueuedAgent, AgentRunJob } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueueableJob, QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { HelpAgent } from '../examples/HelpAgent';
import { Conversation } from '../examples/Conversation';
import { createHelpImage } from '../examples/createHelpImage';
import { prepareDocumentEmbeddings } from '../examples/prepareDocumentEmbeddings';

let database: GeneratedTestDatabase;
let application: App;
let storageRoot: string;
const fetch = vi.fn<typeof globalThis.fetch>();

/** Supplies deterministic Responses API SSE while exercising the real SDK and framework. */
function streamResponse(output: unknown[], text = '', model = 'test-model'): Response {
	const response = { id: `resp_${output.length}_${text.length}`, object: 'response', created_at: 1, model, status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
	const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
	for (const [index, item] of output.entries()) {
		events.push({ type: 'response.output_item.added', output_index: index, item });
		if (text) events.push({ type: 'response.output_text.delta', item_id: 'msg_test', output_index: index, content_index: 0, delta: text });
		events.push({ type: 'response.output_item.done', output_index: index, item });
	}
	events.push({ type: 'response.completed', response });
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

/** Completes one real SDK model turn with a deterministic assistant message. */
function textStream(text = 'Use the settings page.', model = 'test-model') {
	return streamResponse([{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], text, model);
}

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-router-key');
	database = await createGeneratedTestDatabase('ai_app');
	storageRoot = await mkdtemp(join(tmpdir(), 'db3-ai-app-'));
	application = new App({ db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch, models: { conversation: Conversation } }, queue: { driver: 'database', queueMonitor: false }, storage: { disks: { local: { driver: 'local', root: storageRoot } } } });
	await application.db.install(Conversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
	await application.storage.put('help.md', 'Change your password on the settings page.');
	application.queue.registerJob(AgentRunJob);
	registerQueuedAgent('HelpAgent', HelpAgent);
});

beforeEach(async () => {
	fetch.mockReset();
	await AiRateLimitReservation.query().delete();
	await AiRateLimitBucket.query().delete();
	await QueuedJob.query().delete();
	await FailedJob.query().delete();
	await AiMessage.query().delete();
	await AiRequest.query().delete();
	await Conversation.query().delete();
});

afterAll(async () => {
	try { await application?.close(); } finally {
		await database?.destroy();
		if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
		vi.unstubAllEnvs();
	}
});

describe('AI inside an application', () => {
	it.each([
		['insufficient_quota', 'Quota exhausted', false],
		['billing_hard_limit_reached', 'Billing limit reached', false],
		[null, 'You have no credits remaining. Please go to OpenAI API billing.', false],
		['rate_limit_exceeded', 'Too many requests', true],
		[null, 'Too many requests', true],
	] as const)('keeps embedding quota separate from throttling (%s: %s)', async (code, message, deferred) => {
		fetch.mockResolvedValueOnce(Response.json({ error: { code, message } }, { status: 429, headers: { 'x-request-id': 'req_embedding_failure' } }));
		const error = await application.ai.generateEmbedding('PRIVATE customer passage').then(() => null, cause => cause);
		expect(error).toBeInstanceOf(deferred ? AIRateLimitDeferredError : AIProviderStoppedError);
		if (!deferred) expect(error).toMatchObject({ code: 'ai_provider_stopped', providerCode: code, status: 429, requestId: 'req_embedding_failure', reason: 'quota' });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await AiRequest.query().count()).toBe(1);
		expect(await AiRequest.query().first()).toMatchObject({ status: 'failed', errorCode: code, providerRequestId: 'req_embedding_failure' });
		expect(await AiRateLimitReservation.query().count()).toBe(0);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(JSON.stringify(error)).not.toContain('PRIVATE customer passage');
	});

	it.each(['text', 'image'] as const)('retains provider response diagnostics for %s rejection', async operation => {
		fetch.mockResolvedValueOnce(Response.json({ error: { code: 'insufficient_quota', message: 'Quota exhausted' } }, { status: 429, headers: { 'x-request-id': 'req_direct_failure' } }));
		const result = operation === 'text'
			? application.ai.generateText({ instructions: 'Summarise.', input: 'PRIVATE customer passage' })
			: application.ai.generateImage({ prompt: 'PRIVATE customer passage' });
		await expect(result).rejects.toMatchObject({ name: 'AIProviderStoppedError', code: 'ai_provider_stopped', providerCode: 'insufficient_quota', status: 429, requestId: 'req_direct_failure' });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});


	it('fails a queued code-less credit rejection once rather than deferring it indefinitely', async () => {
		/** Exercises direct embeddings through the real queue worker and SQL lifecycle. */
		class QuotaEmbeddingJob extends QueueableJob {
			/** Runs one tracked provider request using the application's real AI service. */
			async handle(): Promise<void> {
				await application.ai.generateEmbedding('PRIVATE customer passage');
			}
		}
		application.queue.registerJob(QuotaEmbeddingJob);
		fetch.mockResolvedValueOnce(Response.json({ error: { message: 'You have no credits remaining. Please go to OpenAI API billing.' } }, { status: 429 }));
		await application.queue.dispatch(new QuotaEmbeddingJob({}), { queue: 'embedding-quota', maxTries: 1 });
		const result = await application.queue.workNextJob('embedding-quota');
		expect(result?.status).toBe('failed');
		expect(result?.error).toBeInstanceOf(AIProviderStoppedError);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(await FailedJob.query().count()).toBe(1);
		expect(await application.queue.workNextJob('embedding-quota')).toBeNull();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('keeps a failed pending embedding write and its SQL bindings out of the thrown error', async () => {
		const error: unknown = await application.ai.generateEmbedding('PRIVATE customer passage', undefined, {
			parentAiRequest: '01M00000000000000000000000',
		}).then(() => null, cause => cause);
		expect(error).toBeInstanceOf(AIRequestTrackingError);
		if (!(error instanceof AIRequestTrackingError)) throw error;
		expect(error).toMatchObject({ stage: 'tracking:pending-request', code: null });
		expect(error.message).not.toContain('PRIVATE customer passage');
		expect(error.stack).not.toContain('PRIVATE customer passage');
		expect(fetch).not.toHaveBeenCalled();
		expect(await AiRequest.query().count()).toBe(0);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('runs the contextual passage example through the real tracked provider service', async () => {
		fetch.mockResolvedValueOnce(Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }], model: 'text-embedding-3-small', usage: { prompt_tokens: 12, total_tokens: 12 } }));
		const result = await prepareDocumentEmbeddings(application.ai, 'Untreated panels need annual care.', 'Timber maintenance');
		expect(result).toHaveLength(1);
		expect(result[0].chunk.text).toBe('Untreated panels need annual care.');
		expect(result[0].vector).toEqual([0.1, 0.2, 0.3]);
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).input).toContain('title: Timber maintenance');
		expect(await AiRequest.query().count()).toBe(1);
	});
	it.each([
		['gpt-6-astra', 0.00306],
		['gpt-6-sol', 0.000612],
		['gpt-6-luna', 0.0000306],
		['gpt-5.6-sol', 0.001224],
	])('persists current %s prices from provider token and cache usage', async (model, expectedCost) => {
		fetch.mockResolvedValueOnce(Response.json({
			model,
			output_text: 'A summary.',
			usage: {
				input_tokens: 200,
				output_tokens: 30,
				total_tokens: 230,
				input_tokens_details: { cached_tokens: 60, cache_write_tokens: 40 },
			},
		}));
		const result = await application.ai.generateTextWithResponse({ model, instructions: 'Summarise.', input: 'A note.' });
		expect(result.text).toBe('A summary.');
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ model, service_tier: 'default' });
		expect(await AiRequest.findByPk(result.aiRequestId!)).toMatchObject({
			model,
			status: 'completed',
			cachedTokens: 60,
			cacheWriteTokens: 40,
			costUSD: expectedCost,
		});
	});

	it.each(['gpt-6-sol', 'gpt-6-luna'])('validates %s structured output through Responses', async model => {
		fetch.mockResolvedValueOnce(Response.json({ model, output_text: '{"title":"A note"}', usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } }));
		const result = await application.ai.generateStructured({ model, instructions: 'Extract a title.', input: 'A note.', schemaName: 'note', schema: z.object({ title: z.string() }), maxOutputTokens: 500 });
		expect(result.data).toEqual({ title: 'A note' });
		const [url, options] = fetch.mock.calls[0];
		expect(String(url)).toMatch(/\/responses$/);
		expect(JSON.parse(String(options?.body))).toMatchObject({ model, service_tier: 'default', text: { format: { type: 'json_schema', strict: true } } });
		expect(await AiRequest.findByPk(result.aiRequestId!)).toMatchObject({ model, status: 'completed', costUSD: model === 'gpt-6-sol' ? 0.00014 : 0.000007 });
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('persists Flare image usage, cost and stored output through the image API', async () => {
		const bytes = Buffer.from('synthetic Flare image');
		fetch.mockResolvedValueOnce(Response.json({
			data: [{ b64_json: bytes.toString('base64') }],
			usage: {
				input_tokens: 30,
				output_tokens: 1000,
				total_tokens: 1030,
				input_tokens_details: { text_tokens: 20, image_tokens: 10, cached_tokens: 6, cached_tokens_details: { text_tokens: 4, image_tokens: 2 } },
			},
		}));
		const result = await application.ai.generateImage({ model: 'gpt-image-2.5-flare', prompt: 'An editorial illustration.', size: '1536x1024', quality: 'low' }, {
			/** Saves the provider bytes using the application's real storage service. */
			store: async image => {
				await application.storage.put('flare.png', Buffer.from(image.b64Json, 'base64'));
				return { path: 'flare.png' };
			},
		});
		expect(result.model).toBe('gpt-image-2.5-flare');
		expect(String(fetch.mock.calls[0][0])).toMatch(/\/images\/generations$/);
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ model: 'gpt-image-2.5-flare', quality: 'low', size: '1536x1024' });
		expect(await application.storage.get('flare.png')).toEqual(bytes);
		expect(await AiRequest.findByPk(result.aiRequestId!)).toMatchObject({
			model: 'gpt-image-2.5-flare',
			status: 'completed',
			inputTokens: 30,
			outputTokens: 1000,
			cachedTokens: 6,
			costUSD: 0.030153,
			response: { path: 'flare.png' },
		});
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('settles an image audit attempt when capacity defers before provider execution', async () => {
		const limiter = new AIRateLimiter();
		const model = 'gpt-image-2.5-flare-capacity-test';
		const leases = [];
		try {
			for (let index = 0; index < 5; index++) leases.push(await limiter.acquire({ endpoint: 'images', model, operation: 'images.generate', estimatedTokens: 0 }));
			fetch.mockClear();
			await expect(application.ai.generateImage({ model, prompt: 'Wait for capacity.' })).rejects.toBeInstanceOf(AIRateLimitDeferredError);
			expect(fetch).not.toHaveBeenCalled();
			const request = await AiRequest.where('model', model).first();
			expect(request?.status).toBe('failed');
			expect(request?.completedAt).toBeTruthy();
			expect(request?.costUSD).toBe(0);
		} finally {
			for (const lease of leases) await limiter.release(lease);
		}
	});

	it.each([
		['gpt-6-astra', 0.0006],
		['gpt-6-sol', 0.00012],
		['gpt-6-luna', 0.000006],
	])('runs %s tools through Responses and persists the price of every SDK turn', async (model, expectedCost) => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_guide', call_id: 'call_guide', name: 'read_help_guide', arguments: '{}' }], '', model))
			.mockResolvedValueOnce(textStream('Use the settings page.', model));
		/** Preserves the workload's reasoning level while selecting the model under test. */
		class ModelHelpAgent extends HelpAgent {
			protected override readonly model = model;
			protected override readonly reasoningEffort = 'medium' as const;
		}
		const result = await new ModelHelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' }).run('Read the guide.');
		expect(result.finalOutput).toBe('Use the settings page.');
		expect(fetch).toHaveBeenCalledTimes(2);
		for (const [url, options] of fetch.mock.calls) {
			expect(String(url)).toMatch(/\/responses$/);
			const body = JSON.parse(String(options?.body));
			expect(body).toMatchObject({ model, service_tier: 'default', reasoning: { effort: 'medium' } });
			expect(body.temperature).toBeUndefined();
			expect(body.top_p).toBeUndefined();
			expect(body.top_logprobs).toBeUndefined();
			expect(body.logprobs).toBeUndefined();
			expect(body.include ?? []).not.toContain('message.output_text.logprobs');
		}
		expect(JSON.stringify(JSON.parse(String(fetch.mock.calls[1][1]?.body)))).toContain('Change your password on the settings page.');
		expect(await AiRequest.runCostSummary(result.aiRequestId!)).toMatchObject({
			providerRequestCount: 2,
			unpricedRequestCount: 0,
			totalCostUSD: expectedCost,
		});
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('completes more than twenty tool rounds with no turn ceiling and resumes its conversation', async () => {
		for (let turn = 1; turn <= 21; turn++) {
			fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: `fc_unlimited_${turn}`, call_id: `call_unlimited_${turn}`, name: 'read_help_guide', arguments: '{}' }]));
		}
		fetch.mockResolvedValueOnce(textStream('Research completed.'));
		const events: string[] = [];
		const agent = new UnlimitedHelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' });
		const result = await agent.stream('Research the guide.', event => { events.push(event.type); });
		expect(result?.finalOutput).toBe('Research completed.');
		expect(events.filter(type => type === 'tool.success')).toHaveLength(21);
		expect(events).not.toContain('run.error');
		expect(fetch).toHaveBeenCalledTimes(22);
		expect((await AiRequest.runCostSummary(result!.aiRequestId))?.providerRequestCount).toBe(22);
		expect(await AiRateLimitReservation.query().count()).toBe(0);

		fetch.mockResolvedValueOnce(textStream('Continued.'));
		const resumed = await new UnlimitedHelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md', conversationId: result!.conversationId }).run('Continue.');
		expect(resumed.finalOutput).toBe('Continued.');
		expect(JSON.stringify(JSON.parse(String(fetch.mock.calls[22][1]?.body)))).toContain('Research completed.');
	});

	it('retains the default eight-turn ceiling for agents that do not opt out', async () => {
		for (let turn = 1; turn <= 8; turn++) {
			fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: `fc_limited_${turn}`, call_id: `call_limited_${turn}`, name: 'read_help_guide', arguments: '{}' }]));
		}
		await expect(new HelpAgent({ guidePath: 'help.md' }).run('Research the guide.')).rejects.toThrow('Max turns (8) exceeded');
		expect(fetch).toHaveBeenCalledTimes(8);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('releases agent capacity before a tool calls the same model without rate-limit headers', async () => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_summary', call_id: 'call_summary', name: 'summarise_note', arguments: '{}' }]))
			.mockResolvedValueOnce(Response.json({ output_text: 'Nested summary.' }))
			.mockResolvedValueOnce(textStream('Summarised.'));
		const events: string[] = [];
		const result = await new SummaryAgent({ user: 'ada', scope: 'team-a' }).stream('Summarise this note.', event => { events.push(event.type); });
		expect(result?.finalOutput).toBe('Summarised.');
		expect(events).toContain('tool.success');
		expect(events).not.toContain('tool.error');
		expect(fetch).toHaveBeenCalledTimes(3);
		const nested = await AiRequest.where({ conversation: result!.conversationId, operation: 'responses.create' }).first();
		expect(nested?.status).toBe('completed');
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('observes headers and permits another agent while the first response is still streaming', async () => {
		const bytes = new TextEncoder().encode(await textStream('First answer.').text());
		let finishStream: (() => void) | undefined;
		fetch.mockImplementationOnce(async () => {
			expect(await AiRateLimitReservation.query().count()).toBe(1);
			return new Response(new ReadableStream({
				/** Holds response bytes until the concurrent agent has completed. */
				start(controller) {
					finishStream = () => { controller.enqueue(bytes); controller.close(); };
				},
			}), { headers: {
				'content-type': 'text/event-stream',
				'x-request-id': 'req_streaming',
				'openai-processing-ms': '25',
				'x-ratelimit-limit-requests': '100',
				'x-ratelimit-remaining-requests': '99',
				'x-ratelimit-reset-requests': '1m',
			} });
		}).mockImplementationOnce(async () => {
			expect(await AiRateLimitReservation.query().count()).toBe(1);
			return textStream('Second answer.');
		});
		const first = new HelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' }).run('First question.');
		try {
			await vi.waitFor(async () => {
				const request = await AiRequest.where({ providerRequestId: 'req_streaming' }).first();
				expect(request?.rateLimitSnapshot?.remainingRequests).toBe(99);
				expect(request?.providerProcessingMs).toBe(25);
				expect(await AiRateLimitReservation.query().count()).toBe(0);
			});
			const bucket = await AiRateLimitBucket.where({ bucketKey: 'openai:responses:test-model' }).first();
			expect(bucket).toMatchObject({ lastProviderRequestId: 'req_streaming', remainingRequests: 99 });
			const second = await new HelpAgent({ user: 'grace', scope: 'team-b', guidePath: 'help.md' }).run('Second question.');
			expect(second.finalOutput).toBe('Second answer.');
		} finally {
			finishStream?.();
			await first;
		}
		expect((await first).finalOutput).toBe('First answer.');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('reserves subsequent SDK turns and preserves a capacity deferral without sending another request', async () => {
		const response = streamResponse([{ type: 'function_call', id: 'fc_limit', call_id: 'call_limit', name: 'read_help_guide', arguments: '{}' }]);
		response.headers.set('x-ratelimit-limit-requests', '1');
		response.headers.set('x-ratelimit-remaining-requests', '0');
		response.headers.set('x-ratelimit-reset-requests', '1m');
		fetch.mockResolvedValueOnce(response);
		const queued = await new HelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' }).queue('Read the guide.', { queue: 'help' });
		const result = await application.queue.workNextJob('help');
		expect(result?.status).toBe('deferred');
		expect(result?.error).toBeInstanceOf(AIRateLimitDeferredError);
		expect(result?.job.attempts).toBe(0);
		expect((await AiRequest.findByPk(queued.aiRequestId!))?.status).toBe('pending');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('stops real SDK queued quota immediately and blocks independent agent turns', async () => {
		fetch.mockResolvedValueOnce(Response.json({ error: { code: 'insufficient_quota', message: 'Exhausted' } }, { status: 429 }));
		await new HelpAgent({ guidePath: 'help.md' }).queue('Help.', { queue: 'quota-agent', maxTries: 5 });
		expect((await application.queue.workNextJob('quota-agent'))?.status).toBe('failed');
		await new HelpAgent({ guidePath: 'help.md' }).queue('Other work.', { queue: 'quota-agent', maxTries: 5 });
		expect((await application.queue.workNextJob('quota-agent'))?.status).toBe('failed');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(await FailedJob.query().count()).toBe(2);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('stops SDK streaming quota and retains prior stream events instead of replaying them', async () => {
		const failure = new Response('data: {"type":"response.failed","response":{"id":"resp_quota","status":"failed","output":[],"error":{"code":"insufficient_quota","message":"Exhausted"}}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
		fetch.mockResolvedValueOnce(failure);
		await new HelpAgent({ guidePath: 'help.md' }).queue('Help.', { queue: 'stream-quota', maxTries: 5 });
		const result = await application.queue.workNextJob('stream-quota');
		expect(result?.status).toBe('failed');
		expect(await QueuedJob.query().count()).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(1);
		await expect(application.ai.generateEmbedding('Blocked.')).rejects.toBeInstanceOf(AIProviderStoppedError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not replay a completed SDK tool/model turn when the next model call hits an outage', async () => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_saved', call_id: 'call_saved', name: 'read_help_guide', arguments: '{}' }]))
			.mockResolvedValueOnce(Response.json({ error: { code: 'server_error' } }, { status: 503 }));
		await new HelpAgent({ guidePath: 'help.md' }).queue('Read the guide.', { queue: 'partial-outage', maxTries: 5 });
		expect((await application.queue.workNextJob('partial-outage'))?.status).toBe('failed');
		expect(await QueuedJob.query().count()).toBe(0);
		expect(await FailedJob.query().count()).toBe(1);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect((await AiMessage.query().all()).some(message => message.role === 'tool')).toBe(true);
	});

	it('releases agent reservations after a transport failure so the next run can start', async () => {
		fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
		await expect(new HelpAgent({ guidePath: 'help.md' }).run('Help.')).rejects.toThrow();
		expect(await AiRateLimitReservation.query().count()).toBe(0);
		await expect(new HelpAgent({ guidePath: 'help.md' }).run('Still blocked.')).rejects.toThrow('temporarily unavailable');
		expect(fetch).toHaveBeenCalledTimes(1);
		await application.ai.providerAdmission.reset(application.ai.resolveProviders()[0]!);
		fetch.mockResolvedValueOnce(textStream('Recovered.'));
		expect((await new HelpAgent({ guidePath: 'help.md' }).run('Try again.')).finalOutput).toBe('Recovered.');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	});

	it('runs a function-calling agent with the real SDK and reloads its persisted conversation', async () => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_help_guide', arguments: '{}' }])).mockResolvedValueOnce(textStream());
		const events: string[] = [];
		const agent = new HelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' });
		const result = await agent.stream('How do I change my password?', event => { events.push(event.type); });
		expect(result?.finalOutput).toBe('Use the settings page.');
		expect(events).toContain('tool.success');
		const conversation = await Conversation.findByPk(result!.conversationId);
		expect(conversation).toMatchObject({ user: 'ada', scope: 'team-a', topic: 'support' });
		const messages = await AiMessage.where({ conversation: result!.conversationId }).orderBy('sequence').all();
		const requests = await AiRequest.where({ conversation: result!.conversationId }).all();
		const timeline = agentConversationTimeline(messages, [], requests);
		expect(timeline.some(item => item.kind === 'tool' && item.state === 'success')).toBe(true);
		expect((await AiRequest.runCostSummary(result!.aiRequestId))?.providerRequestCount).toBe(2);
		expect((await CustomRequest.runCostSummary(result!.aiRequestId))?.providerRequestCount).toBe(2);
		const secondCall = JSON.parse(String(fetch.mock.calls[1][1]?.body));
		expect(JSON.stringify(secondCall)).toContain('Change your password on the settings page.');
		fetch.mockResolvedValueOnce(textStream('Open Settings.'));
		await new HelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md', conversationId: result!.conversationId }).run('Which page?');
		expect(JSON.stringify(JSON.parse(String(fetch.mock.calls[2][1]?.body)))).toContain('How do I change my password?');
		await expect(new HelpAgent({ user: 'mallory', scope: 'team-a', guidePath: 'help.md', conversationId: result!.conversationId }).run('Read their history')).rejects.toThrow('Permission denied');
		await expect(new HelpAgent({ user: 'ada', scope: 'team-b', guidePath: 'help.md', conversationId: result!.conversationId }).run('Read another workspace')).rejects.toThrow('Permission denied');
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('does not let an identified user adopt an anonymous conversation', async () => {
		fetch.mockResolvedValueOnce(textStream('Anonymous answer.')).mockResolvedValueOnce(textStream('Continued anonymously.'));
		const first = await new HelpAgent({ guidePath: 'help.md' }).run('Help.');
		await new HelpAgent({ guidePath: 'help.md', conversationId: first.conversationId }).run('Continue.');
		await expect(new HelpAgent({ user: 'ada', guidePath: 'help.md', conversationId: first.conversationId }).run('Read this history')).rejects.toThrow('Permission denied');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('restores a queued agent and saves its completed result', async () => {
		const queued = await new HelpAgent({ user: 'ada', scope: 'team-a', guidePath: 'help.md' }).queue('Help me.', { queue: 'help' });
		expect(fetch).not.toHaveBeenCalled();
		fetch.mockResolvedValueOnce(textStream('Queued answer.'));
		expect((await application.queue.workNextJob('help'))?.status).toBe('succeeded');
		expect((await AiRequest.findByPk(queued.aiRequestId!))?.status).toBe('completed');
		expect(await AiMessage.where({ conversation: queued.conversationId, content: 'Queued answer.' }).count()).toBe(1);
	});

	it('links provider calls made by a tool to its agent attempt and clears context afterward', async () => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'embed_note', arguments: '{}' }]))
			.mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [0.2, 0.4] }], model: 'text-embedding-3-small' }))
			.mockResolvedValueOnce(textStream('Indexed.'));
		const result = await new IndexAgent({ user: 'ada', scope: 'team-a' }).run('Index this note.');
		const requests = await AiRequest.where({ conversation: result.conversationId }).all();
		const embedding = requests.find(request => request.operation === 'embeddings.create');
		expect(embedding).toBeDefined();
		expect(embedding).toMatchObject({ user: 'ada', scope: 'team-a' });
		expect(embedding?.parentAiRequest).toBeTruthy();
		expect((await AiRequest.runCostSummary(result.aiRequestId!))?.providerRequestCount).toBe(3);
		fetch.mockResolvedValueOnce(Response.json({ output_text: 'Independent.' }));
		const outside = await application.ai.generateTextWithResponse({ instructions: 'Reply.', input: 'Hello.' });
		expect((await AiRequest.findByPk(outside.aiRequestId!))?.parentAiRequest).toBeNull();
	});

	it('records failed provider work and fails over a text request to its next configured provider', async () => {
		fetch.mockResolvedValueOnce(Response.json({ error: { message: 'Temporarily unavailable' } }, { status: 503 }))
			.mockResolvedValueOnce(Response.json({ output_text: 'Recovered.', usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } }));
		const result = await application.ai.generateTextWithResponse({ instructions: 'Reply.', input: 'Hello.', provider: { openai: 'test-model', openrouter: 'test-model' } });
		expect(result.text).toBe('Recovered.');
		const requests = await AiRequest.where({ conversation: result.conversationId }).all();
		expect(requests.some(request => request.status === 'failed' && request.provider === 'openai')).toBe(true);
		expect(requests.some(request => request.status === 'completed' && request.provider === 'openrouter')).toBe(true);
	});

	it('rejects invalid input before provider work and retains a failed incomplete response', async () => {
		await expect(application.ai.generateText({ instructions: 'Reply.', input: ' ', maxOutputTokens: 10 })).rejects.toMatchObject({ code: 'invalid_input' });
		await expect(application.ai.generateText({ instructions: 'Reply.', input: 'Hello.', maxOutputTokens: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
		expect(fetch).not.toHaveBeenCalled();
		expect(await AiRequest.query().count()).toBe(0);
		fetch.mockResolvedValueOnce(Response.json({ status: 'incomplete', output_text: 'A truncated answer.', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }));
		await expect(application.ai.generateText({ instructions: 'Reply.', input: 'Hello.' })).rejects.toThrow('valid response');
		expect((await AiRequest.query().first())?.status).toBe('failed');
		expect((await AiRequest.query().first())?.outputTokens).toBe(2);
	});

	it('tracks text, schema-validated output, image storage and embeddings with real models', async () => {
		fetch.mockResolvedValueOnce(Response.json({ output_text: 'A summary.', usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } }));
		const text = await application.ai.generateTextWithResponse({ instructions: 'Summarise.', input: 'A note.' }, { user: 'ada', scope: 'team-a' });
		expect((await AiRequest.findByPk(text.aiRequestId!))?.inputTokens).toBe(10);
		fetch.mockResolvedValueOnce(Response.json({ output_text: '{"title":"A note"}' }));
		const structured = await application.ai.generateStructured({ instructions: 'Extract a title.', input: 'A note.', schemaName: 'note', schema: z.object({ title: z.string() }) });
		expect(structured.data.title).toBe('A note');
		const bytes = Buffer.from('test image bytes');
		fetch.mockResolvedValueOnce(Response.json({ data: [{ b64_json: bytes.toString('base64') }] }));
		const image = await createHelpImage('A help icon.', 'help.png');
		expect(await application.storage.get('help.png')).toEqual(bytes);
		expect((await AiRequest.findByPk(image.aiRequestId!))?.response).toMatchObject({ disk: 'local', path: 'help.png' });
		fetch.mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [0.2, 0.4] }], model: 'text-embedding-3-small', usage: { prompt_tokens: 4, total_tokens: 4 } }));
		const embedding = await application.ai.generateEmbedding('A note.');
		expect(embedding.vector).toEqual([0.2, 0.4]);
		expect((await AiRequest.findByPk(embedding.aiRequestId!))?.status).toBe('completed');
	});
	it.each(['insufficient_quota', 'server_error'])('fails over a nested HTTP-200 %s admission rejection and retains both outcomes', async code => {
		fetch.mockResolvedValueOnce(Response.json({ response: { error: { code, message: 'Synthetic nested provider rejection' } }, usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 } }))
			.mockResolvedValueOnce(Response.json({ output_text: 'Fallback saved result.', usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } }));
		const result = await application.ai.generateTextWithResponse({ instructions: 'Reply.', input: 'Hello.', provider: { openai: 'test-model', openrouter: 'test-model' } });
		expect(result.text).toBe('Fallback saved result.');
		expect(fetch).toHaveBeenCalledTimes(2);
		const requests = await AiRequest.query().all();
		expect(requests.some(request => request.status === 'failed' && request.provider === 'openai' && request.totalTokens === 5)).toBe(true);
		expect(requests.some(request => request.status === 'completed' && request.provider === 'openrouter')).toBe(true);
		await expect(application.ai.providerAdmission.acquire({ provider: 'openai', apiKey: 'synthetic-test-key', baseUrl: 'https://api.openai.com/v1', model: 'another-model', supportsResponsesApi: true })).rejects.toBeInstanceOf(code === 'insufficient_quota' ? AIProviderStoppedError : AIProviderDeferredError);
	});

});

/** Exercises natural completion across many real SDK turns using the saved help guide. */
class UnlimitedHelpAgent extends HelpAgent {
	protected override readonly maxTurns = null;
}

/** Exercises a nested provider operation through the agent convenience API. */
class IndexAgent extends Agent {
	/** Defines the indexing task executed by this test agent. */
	async instructions(): Promise<string> { return 'Call embed_note and report completion.'; }

	/** Exposes one app-owned operation while preserving its request parentage. */
	protected tools(): AgentTool[] {
		return [Object.assign(tool({ name: 'embed_note', description: 'Index the note.', parameters: z.object({}), execute: async () => this.generateEmbedding('A note.') }), { title: 'Index note' })];
	}
}

/** An app can inherit request aggregation without replacing its table or fields. */
class CustomRequest extends AiRequest {}

/** Exercises a same-model provider call while the parent agent is executing a tool. */
class SummaryAgent extends Agent {
	/** Defines the note-summary workflow used to verify nested provider capacity. */
	async instructions(): Promise<string> { return 'Call summarise_note and report completion.'; }

	/** Exposes a nested text request through the real AI service. */
	protected tools(): AgentTool[] {
		return [Object.assign(tool({ name: 'summarise_note', description: 'Summarise the note.', parameters: z.object({}),
			/** Calls the same model through the service with inherited request parentage. */
			execute: async () => application.ai.generateText({ instructions: 'Summarise.', input: 'A note.', model: 'test-model' }),
		}), { title: 'Summarise note' })];
	}
}
