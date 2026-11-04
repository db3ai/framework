import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { Agent, AiConversation, AiMessage, AiRateLimitBucket, AiRateLimitReservation, AiRequest, AIProviderRetryError, AIProviderStoppedError, AgentRunJob, registerQueuedAgent, type AgentTool } from '@db3.ai/app/ai';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
let application: App;
const fetcher = vi.fn<typeof fetch>();
const encoder = new TextEncoder();
const inProgress = { id: 'resp_timeout', object: 'response', created_at: 1, model: 'test-model', status: 'in_progress', output: [] };
const created = `data: ${JSON.stringify({ type: 'response.created', sequence_number: 0, response: inProgress })}\n\n`;

/** The smallest real agent, so these failures cross the real SDK. */
class TimeoutAgent extends Agent {
	/** Needs no real task; the provider is simulated. */
	async instructions(): Promise<string> { return 'Answer.'; }
	/** Keeps every run to one model turn. */
	protected tools(): AgentTool[] { return []; }
}

/** Rejects when the request is aborted, like a provider that never answers. */
const neverResponds: typeof fetch = (_url, init) => new Promise((_, reject) => {
	init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
});

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	database = await createGeneratedTestDatabase('ai_provider_inactivity');
	application = new App({ db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch: fetcher, timeoutMs: 80, models: { conversation: AiConversation } }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
	application.queue.registerJob(AgentRunJob);
	registerQueuedAgent('TimeoutAgent', TimeoutAgent);
});
beforeEach(async () => {
	fetcher.mockReset();
	await QueuedJob.query().delete();
	await FailedJob.query().delete();
	await AiMessage.query().delete();
	await AiRequest.query().delete();
});
afterAll(async () => {
	try { await application?.close(); } finally {
		await database?.destroy();
		vi.unstubAllEnvs();
	}
});

/** Runs one queued attempt, as a worker would, and returns its failure and outcome. */
async function attempt() {
	await new TimeoutAgent({}).queue('Hello.', { queue: 'timeouts' });
	return application.queue.workNextJob('timeouts');
}

describe('provider inactivity timeout through a real agent run', () => {
	it('reports a response that never starts by name, leaving it retryable', async () => {
		fetcher.mockImplementation(neverResponds);
		const result = await attempt();
		expect(result?.status).toBe('released');
		expect(result?.error).toBeInstanceOf(AIProviderRetryError);
		expect(result?.error).toMatchObject({ providerCode: 'ai_provider_inactivity_timeout', message: 'AI provider sent nothing for 80ms; the request appears stuck.' });
	});

	it('stops a stream that stalls after output, saying why', async () => {
		fetcher.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(encoder.encode(created)); },
		}), { headers: { 'content-type': 'text/event-stream' } }));
		const result = await attempt();
		expect(result?.status).toBe('failed');
		expect(result?.error).toBeInstanceOf(AIProviderStoppedError);
		expect(result?.error).toMatchObject({
			providerCode: 'ai_provider_inactivity_timeout',
			message: 'AI provider sent nothing for 80ms; the request appears stuck. This run stopped to prevent unsafe replay.',
		});
		expect(await AiRequest.query().firstOrFail()).toMatchObject({ status: 'failed', errorMessage: (result?.error as Error).message });
	});

	it('lets a stream that keeps delivering run well past the limit', async () => {
		const completed = { ...inProgress, status: 'completed', output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
		let sequence = 1;
		fetcher.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
			start(controller) { controller.enqueue(encoder.encode(created)); },
			async pull(controller) {
				await new Promise(resolve => setTimeout(resolve, 40));
				if (sequence <= 6) { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.in_progress', sequence_number: sequence++, response: inProgress })}\n\n`)); return; }
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed', sequence_number: sequence, response: completed })}\n\n`));
				controller.close();
			},
		}), { headers: { 'content-type': 'text/event-stream' } }));
		const started = Date.now();
		await expect(new TimeoutAgent({}).run('Hello.')).resolves.toMatchObject({ finalOutput: 'Done.' });
		expect(Date.now() - started).toBeGreaterThan(200);
	});
});
