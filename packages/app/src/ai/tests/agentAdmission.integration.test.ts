import { randomUUID } from 'node:crypto';
import { createClient } from '@redis/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { ActiveRecord } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Agent, AgentRunJob, AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, registerQueuedAgent, type AgentTool } from '@db3.ai/app/ai';
import { FailedJob, QueuedJob, RedisQueueDriver, type QueueProcessResult } from '@db3.ai/app/queue';

/** Runs real queued AI persistence and reconstruction against a controlled external provider. */
class AdmissionAgent extends Agent {
	/** Supplies deterministic instructions without application side effects. */
	instructions(): string { return 'Answer briefly.'; }
	/** Keeps this boundary test independent of product tools. */
	protected tools(): AgentTool[] { return []; }
}

const redisUrl = process.env.QUEUE_REDIS_URL ?? process.env.REDIS_URL;
if (process.env.TEST_REDIS_REQUIRED === '1' && !redisUrl) throw new Error('Queue admission verification requires an explicit test Redis URL.');

for (const driverName of ['database', 'redis'] as const) {
	describe.skipIf(driverName === 'redis' && !redisUrl)(`agent admission through ${driverName}`, () => {
		let database: GeneratedTestDatabase;
		let application: App;
		let redis: RedisQueueDriver | undefined;
		const prefix = `db3:test:agent-admission:${randomUUID()}:`;
		const fetch = vi.fn<typeof globalThis.fetch>();

		beforeAll(async () => {
			vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
			database = await createGeneratedTestDatabase(`admission_${driverName}`);
			if (driverName === 'redis') redis = new RedisQueueDriver({ url: redisUrl, keyPrefix: prefix, connectionTimeoutMs: 1000 });
			application = new App({ db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', rateLimiter: false, fetch, streaming: { enabled: true, authorize: () => true } }, queue: { driver: redis ?? 'database', queueMonitor: false } });
			await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
			application.queue.registerJob(AgentRunJob);
			registerQueuedAgent('AdmissionAgent', AdmissionAgent);
		});
		beforeEach(async () => {
			await application.ai.conversations.drain();
			fetch.mockReset();
			for (const Model of [AiMessage, AiRequest, QueuedJob, FailedJob, AiConversation]) await Model.query().delete();
		});
		afterEach(async () => {
			if (!redisUrl || !redis) return;
			const client = createClient({ url: redisUrl });
			try {
				await client.connect();
				for await (const keys of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) if (keys.length) await client.del(keys);
			} finally { if (client.isOpen) await client.quit(); }
		});
		afterAll(async () => {
			try { await application?.close(); }
			finally { try { await redis?.close(); } finally { await database?.destroy(); vi.unstubAllEnvs(); } }
		});

		it('acknowledges an opaque id before execution and retains it through provider completion', async () => {
			let preparationCommitted = false;
			const unsubscribe = application.queue.events.subscribe(async event => {
				if (event.action !== 'dispatched') return;
				preparationCommitted = !ActiveRecord.getScopedDb()?.isTransaction && await AiRequest.query().count() === 1 && await AiMessage.where('role', 'user').count() === 1;
			});
			try {
				const queued = await new AdmissionAgent({ user: 'viewer', scope: 'team' }).queue('One request', { queue: 'agents', idempotencyKey: 'send' });
				expect(preparationCommitted).toBe(true);
				expect(typeof queued.jobId).toBe(driverName === 'redis' ? 'string' : 'number');
				expect(fetch).not.toHaveBeenCalled();
				expect((await AiRequest.findOrFail(queued.aiRequestId!)).request).toMatchObject({ queueJobId: queued.jobId });
				fetch.mockResolvedValueOnce(completedProviderResponse());
				expect(await application.queue.workNextJob('agents')).toMatchObject({ status: 'succeeded', job: { id: queued.jobId } });
				expect((await AiRequest.findOrFail(queued.aiRequestId!))).toMatchObject({ status: 'completed', request: { queueJobId: queued.jobId }, response: { finalOutput: 'Done' } });
				expect(await application.queue.workNextJob('agents')).toBeNull();
			} finally { unsubscribe(); }
		});

		it('reuses concurrent submission receipts without duplicating records or deliveries', async () => {
			/** Models two simultaneous HTTP sends carrying the same stable submission key. */
			const send = () => new AdmissionAgent({ user: 'viewer', scope: 'team' }).queue('One request', { queue: 'agents', idempotencyKey: 'same-send' });
			const [first, second] = await Promise.all([send(), send()]);
			expect(second).toEqual(first);
			expect(await AiConversation.query().count()).toBe(1);
			expect(await AiRequest.query().count()).toBe(1);
			await expect(new AdmissionAgent({ user: 'viewer', scope: 'team' }).queue('Changed request', { idempotencyKey: 'same-send' })).rejects.toMatchObject({ statusCode: 409 });
			fetch.mockResolvedValueOnce(completedProviderResponse());
			expect((await application.queue.workNextJob('agents'))?.status).toBe('succeeded');
			expect(await application.queue.workNextJob('agents')).toBeNull();
			expect(fetch).toHaveBeenCalledOnce();
		});

		it('preserves an already completed run when execution beats the dispatch acknowledgement', async () => {
			fetch.mockResolvedValueOnce(completedProviderResponse());
			let execution: QueueProcessResult | null = null;
			const unsubscribe = application.queue.events.subscribe(async event => {
				if (event.action === 'dispatched') execution = await application.queue.workNextJob(event.queue);
			});
			try {
				const queued = await new AdmissionAgent({ user: 'viewer', scope: 'team' }).queue('Fast request', { queue: 'agents', idempotencyKey: 'fast-send' });
				expect(execution).toMatchObject({ status: 'succeeded', job: { id: queued.jobId } });
				expect(await AiRequest.findOrFail(queued.aiRequestId!)).toMatchObject({ status: 'completed', request: { queueJobId: queued.jobId, instructions: 'Answer briefly.' }, response: { finalOutput: 'Done' }, metadata: { queueJobId: queued.jobId } });
				expect(await new AdmissionAgent({ user: 'viewer', scope: 'team' }).queue('Fast request', { queue: 'agents', idempotencyKey: 'fast-send' })).toEqual(queued);
				expect(fetch).toHaveBeenCalledOnce();
			} finally { unsubscribe(); }
		});
	});
}

/** Emits a complete provider SSE response; every queue, SQL and agent component remains real. */
function completedProviderResponse(): Response {
	const item = { type: 'message', id: 'msg_admission', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] };
	const response = { id: 'resp_admission', object: 'response', created_at: 1, model: 'test-model', status: 'completed', output: [item], usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
	const events = [
		{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
		{ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
		{ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Done' },
		{ type: 'response.output_item.done', output_index: 0, item },
		{ type: 'response.completed', response },
	];
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
