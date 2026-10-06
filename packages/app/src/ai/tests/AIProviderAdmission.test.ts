import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { Ai, AI_PROVIDER, AIProviderAdmission, AIProviderDeferredError, AIProviderStoppedError, AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, AIRateLimitDeferredError, type AIProviderAttempt } from '@db3.ai/app/ai';
import { QueueableJob, QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
let application: App;
const attempt: AIProviderAttempt = { provider: AI_PROVIDER.openai, apiKey: 'synthetic-account', baseUrl: 'https://synthetic.invalid/v1', model: 'test', supportsResponsesApi: true };
const quota = { error: { code: 'insufficient_quota', message: 'No credits' }, status: 429 };
const outage = { status: 503 };
const policy = { initialSeconds: 1, maxSeconds: 4, failureWindowSeconds: 10, recoveryLeaseSeconds: 2 };

beforeAll(async () => {
	database = await createGeneratedTestDatabase('provider_admission');
	application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
});
beforeEach(async () => {
	await AiRateLimitReservation.query().delete();
	await AiRequest.query().delete();
	await AiRateLimitBucket.query().delete();
	await QueuedJob.query().delete();
	await FailedJob.query().delete();
});
afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); vi.unstubAllEnvs(); } });

describe('SQL provider account admission', () => {
	it('stops both workers across endpoints and restart after quota, isolating other identities', async () => {
		const guard = new AIProviderAdmission(policy);
		const [first, late] = await Promise.all([guard.acquire(attempt), guard.acquire(attempt)]);
		expect(await guard.failure(attempt, first, quota)).toBeInstanceOf(AIProviderStoppedError);
		await guard.success(attempt, late);
		const restarted = new AIProviderAdmission(policy);
		await expect(restarted.acquire({ ...attempt, model: 'different-image-model' })).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(restarted.acquire({ ...attempt, apiKey: 'different-account' })).resolves.toBeDefined();
		await expect(restarted.acquire({ ...attempt, baseUrl: 'https://different.invalid/v1' })).resolves.toBeDefined();
		await expect(restarted.acquire({ ...attempt, provider: AI_PROVIDER.openrouter })).resolves.toBeDefined();
		const rows = await AiRateLimitBucket.query().all();
		expect(JSON.stringify(rows.map(row => row.toJSON()))).not.toContain(attempt.apiKey);
	});

	it('does not turn caller cancellation into an outage or clear an existing recovery lease', async () => {
		const guard = new AIProviderAdmission(policy);
		const cancelled = new DOMException('The caller stopped this request.', 'AbortError');
		const fetcher = vi.fn<typeof globalThis.fetch>().mockRejectedValue(cancelled);
		await expect(guard.transport(attempt, fetcher)('https://synthetic.invalid/v1/responses')).rejects.toBe(cancelled);
		await expect(new AIProviderAdmission(policy).acquire(attempt)).resolves.toMatchObject({ probe: null });
		const now = Date.now();
		const lease = await guard.acquire(attempt, now);
		await guard.failure(attempt, lease, outage, now);
		const probe = await guard.acquire(attempt, now + 1001);
		const wrapped = Object.assign(new Error('SDK connection wrapper', { cause: cancelled }), { name: 'APIConnectionError' });
		expect(await guard.failure(attempt, probe, wrapped, now + 1002)).toBeNull();
		await expect(guard.acquire(attempt, now + 1003)).rejects.toBeInstanceOf(AIProviderDeferredError);
		await expect(guard.acquire(attempt, now + 3002)).resolves.toBeDefined();
	});

	it('bounds rejection diagnostics and never retains provider messages in cooldown errors', async () => {
		const guard = new AIProviderAdmission(policy);
		const lease = await guard.acquire(attempt);
		const error = await guard.failure(attempt, lease, { status: 503, requestId: 'Bearer PRIVATE secret', error: { code: 'PRIVATE customer text', message: 'PRIVATE article content' } });
		expect(error).toMatchObject({ providerCode: null, diagnostics: { status: 503, requestId: null }, providerStarted: true });
		expect(JSON.stringify(error)).not.toMatch(/PRIVATE|Bearer|secret|article/);
	});

	it('keeps quota messages separate from ordinary 429 capacity', async () => {
		const guard = new AIProviderAdmission(policy);
		const lease = await guard.acquire(attempt);
		expect(await guard.failure(attempt, lease, { status: 429, error: { code: 'rate_limit_exceeded' } })).toBeNull();
		await expect(guard.acquire(attempt)).resolves.toBeDefined();
		expect(await guard.failure(attempt, lease, { status: 429, error: { message: 'You have no credits remaining. Please go to billing.' } })).toBeInstanceOf(AIProviderStoppedError);
	});

	it('admits one recovery request across two workers, fences late success and expires crashed probes', async () => {
		const now = Date.now();
		const first = new AIProviderAdmission(policy);
		const second = new AIProviderAdmission(policy);
		const lease = await first.acquire(attempt, now);
		await first.failure(attempt, lease, outage, now);
		const results = await Promise.allSettled([first.acquire(attempt, now + 1001), second.acquire(attempt, now + 1001)]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		const probe = results.find(result => result.status === 'fulfilled')! as PromiseFulfilledResult<Awaited<ReturnType<AIProviderAdmission['acquire']>>>;
		await first.success(attempt, lease, now + 1002);
		await expect(second.acquire(attempt, now + 1500)).rejects.toBeInstanceOf(AIProviderDeferredError);
		const replacement = await second.acquire(attempt, now + 3002);
		await first.success(attempt, probe.value, now + 3003);
		await expect(first.acquire(attempt, now + 3004)).rejects.toBeInstanceOf(AIProviderDeferredError);
		await second.success(attempt, replacement, now + 3004);
		await expect(first.acquire(attempt, now + 3005)).resolves.toMatchObject({ probe: null });
	});

	it('backs off exponentially, never resets expired episodes with new dispatches, and requires explicit repair', async () => {
		const now = Date.now();
		const guard = new AIProviderAdmission(policy);
		let lease = await guard.acquire(attempt, now);
		await guard.failure(attempt, lease, outage, now);
		lease = await guard.acquire(attempt, now + 1001);
		const second = await guard.failure(attempt, lease, Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(), { code: 'ECONNRESET' }) }), now + 1001);
		expect((second as AIProviderDeferredError).retryAt.getTime()).toBe(now + 3001);
		lease = await guard.acquire(attempt, now + 3002);
		const third = await guard.failure(attempt, lease, Object.assign(new Error(), { name: 'TimeoutError' }), now + 3002);
		expect((third as AIProviderDeferredError).retryAt.getTime()).toBe(now + 7002);
		await expect(new AIProviderAdmission(policy).acquire(attempt, now + 10001)).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(guard.acquire(attempt, now + 100000)).rejects.toBeInstanceOf(AIProviderStoppedError);
		await guard.success(attempt, lease, now + 10002);
		await expect(guard.acquire(attempt, now + 10003)).rejects.toBeInstanceOf(AIProviderStoppedError);
		await guard.reset(attempt);
		await expect(guard.acquire(attempt)).resolves.toMatchObject({ probe: null });
	});

	it('never clears a newer quota trip from an earlier recovery success', async () => {
		const now = Date.now();
		const guard = new AIProviderAdmission(policy);
		const old = await guard.acquire(attempt, now);
		await guard.failure(attempt, old, outage, now);
		const probe = await guard.acquire(attempt, now + 1001);
		await guard.failure(attempt, old, quota, now + 1002);
		await guard.success(attempt, probe, now + 1003);
		await expect(guard.acquire(attempt, now + 1004)).rejects.toBeInstanceOf(AIProviderStoppedError);
	});

	it('guards all direct paths with capacity limiting disabled and performs no HTTP while stopped', async () => {
		vi.stubEnv('AI_RATE_LIMITER_DISABLED', 'true');
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }));
		const ai = new Ai({ apiKey: attempt.apiKey, baseUrl: attempt.baseUrl, model: 'test', fetch, rateLimiter: false });
		await expect(ai.generateEmbedding('first')).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(ai.generateText({ instructions: '', input: 'blocked' })).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(ai.generateStructured({ instructions: '', input: 'blocked', schemaName: 'test', schema: (await import('zod')).z.object({ answer: (await import('zod')).z.string() }) })).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(ai.generateImage({ prompt: 'blocked' })).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(ai.createAgentProvider(attempt).getModel('test')).resolves.toBeDefined();
		expect(fetch).toHaveBeenCalledTimes(1);
		vi.unstubAllEnvs();
	});

	it('defers queue work without reservation or try, then fails visibly at durable episode expiry', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: { code: 'server_error' } }, { status: 503 }));
		const ai = new Ai({ apiKey: attempt.apiKey, baseUrl: attempt.baseUrl, model: 'test', fetch, rateLimiter: false });
		/** Executes one mock-provider embedding through the real durable queue. */
		class AdmissionJob extends QueueableJob {
			/** Lets admission determine whether this queue delivery may contact the provider. */
			async handle(): Promise<void> { await ai.generateEmbedding('work'); }
		}
		application.queue.registerJob(AdmissionJob);
		await application.queue.dispatch(new AdmissionJob({}), { queue: 'admission', maxTries: 5 });
		expect((await application.queue.workNextJob('admission'))?.status).toBe('deferred');
		const queued = (await QueuedJob.query().all())[0];
		expect(queued.attempts).toBe(0);
		expect(queued.reservedAt).toBeNull();
		expect(await FailedJob.query().count()).toBe(0);
		// Move only task-owned SQL timestamps, avoiding sleeps and fake provider calls.
		const bucket = (await AiRateLimitBucket.query().all())[0];
		const metadata = bucket.metadata!;
		(metadata.admission as { deadline: number }).deadline = Date.now() - 1;
		bucket.metadata = metadata;
		await bucket.save();
		await QueuedJob.query().patch({ availableAt: Math.floor(Date.now() / 1000) - 1 });
		expect((await application.queue.workNextJob('admission'))?.status).toBe('failed');
		expect(await FailedJob.query().count()).toBe(1);
		expect(await QueuedJob.query().count()).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('trips streaming quota and does not mistake headers or a late stream success for recovery', async () => {
		const guard = new AIProviderAdmission(policy);
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('data: {"type":"response.failed","response":{"error":{"code":"insufficient_quota"}}}\n\n', { headers: { 'content-type': 'text/event-stream' } }));
		const response = await guard.transport(attempt, fetch)('https://synthetic.invalid');
		expect(await response.text()).toContain('response.failed');
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderStoppedError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
