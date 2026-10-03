import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@db3.ai/app/server';
import { AI_PROVIDER, AIProviderAdmission, AIProviderDeferredError, AIProviderStoppedError, AiRateLimitBucket, type AIProviderAttempt } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
let application: App;
const attempt: AIProviderAttempt = { provider: AI_PROVIDER.openai, apiKey: 'synthetic-stream-account', baseUrl: 'https://synthetic.invalid/v1', model: 'test', supportsResponsesApi: true };
const completion = 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n';

/** Emits original encoded provider bytes with an explicit arbitrary transport boundary. */
function streamResponse(bytes: Uint8Array, chunkSize = 1, cancel = vi.fn()): Response {
	let offset = 0;
	return new Response(new ReadableStream<Uint8Array>({
		/** Delivers one source chunk, preserving UTF-8 and delimiter fragmentation. */
		pull(controller) {
			if (offset === bytes.length) { controller.close(); return; }
			controller.enqueue(bytes.slice(offset, offset + chunkSize));
			offset = Math.min(bytes.length, offset + chunkSize);
		},
		/** Records propagation of consumer cancellation to the external transport. */
		cancel,
	}), { headers: { 'content-type': 'text/event-stream' } });
}

/** Starts an already eligible SQL recovery episode without waiting or contacting a provider. */
async function recovery(): Promise<AIProviderAdmission> {
	const guard = new AIProviderAdmission({ initialSeconds: 1, maxSeconds: 4, failureWindowSeconds: 60, recoveryLeaseSeconds: 10 });
	const lease = await guard.acquire(attempt);
	await guard.failure(attempt, lease, { status: 503 }, Date.now() - 1100);
	return guard;
}

/** Consumes the wrapped transport and proves that the SDK receives the exact input bytes. */
async function consume(guard: AIProviderAdmission, bytes: Uint8Array, chunkSize = 1): Promise<void> {
	const response = await guard.transport(attempt, async () => streamResponse(bytes, chunkSize))('https://synthetic.invalid');
	expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
}

beforeAll(async () => {
	database = await createGeneratedTestDatabase('provider_admission_stream');
	application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false } });
	await application.db.install(AiRateLimitBucket);
});
beforeEach(async () => { await AiRateLimitBucket.query().delete(); });
afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); } });

describe('provider recovery SSE observation', () => {
	it.each(['\n', '\r', '\r\n'])('joins data fields and handles every-byte UTF-8 and %j fragmentation', async newline => {
		const guard = await recovery();
		const text = [': heartbeat', 'event: response.output_text.delta', 'data: {"type":"response.output_text.delta","delta":"Café 🌍"}', '', 'data: {"type":"response.completed",', 'data: "response":{"status":"completed"}}', '', ''].join(newline);
		await consume(guard, new TextEncoder().encode(text));
		await expect(guard.acquire(attempt)).resolves.toMatchObject({ probe: null });
	});

	it('accepts a fully framed compatible DONE marker after valid data', async () => {
		const guard = await recovery();
		await consume(guard, new TextEncoder().encode('data: {"choices":[]}\n\ndata: [DONE]\n\n'));
		await expect(guard.acquire(attempt)).resolves.toMatchObject({ probe: null });
	});

	it.each([1, 2, 7, 1024])('detects later multiline quota after malformed data with %i-byte chunks', async chunkSize => {
		const guard = await recovery();
		const text = 'data: {malformed}\r\n\r\ndata: {"type":"response.failed",\r\ndata: "response":{"error":{"code":"insufficient_quota","message":"Crédits 🌍"}}}\r\n\r\n';
		await consume(guard, new TextEncoder().encode(text), chunkSize);
		expect(guard.requestFailure(attempt, null)).toBeInstanceOf(AIProviderStoppedError);
		await expect(guard.acquire(attempt)).rejects.toMatchObject({ reason: 'quota' });
	});

	it.each([
		'',
		'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
		'data: {"type":"response.completed"}',
		'data: {"type":"response.completed"}\n',
		`data: {malformed}\n\n${completion}`,
		`data: []\n\n${completion}`,
		'data: {"type":"response.completed"}\n\n',
		'data: {"type":"response.completed","response":{"status":"incomplete"}}\n\n',
		`${completion}data: {"type":`,
		`data: {"type":"error","code":"rate_limit_exceeded"}\n\n${completion}`,
	])('retains the probe after malformed or incomplete input %j', async text => {
		const guard = await recovery();
		await consume(guard, new TextEncoder().encode(text));
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
		expect((await AiRateLimitBucket.query().first())?.metadata?.admission).toMatchObject({ probe: expect.any(String) });
	});

	it('flushes incomplete UTF-8 at EOF without clearing recovery or changing delivered bytes', async () => {
		const guard = await recovery();
		const completeBytes = new TextEncoder().encode(completion);
		const bytes = new Uint8Array(completeBytes.length + 1);
		bytes.set(completeBytes); bytes[bytes.length - 1] = 0xc3;
		await consume(guard, bytes);
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
	});

	it('bounds oversized joined events and lines while still observing a later quota event', async () => {
		const guard = await recovery();
		const text = `data: ${'x'.repeat(1_048_577)}\n\n${`data: ${'x'.repeat(1024)}\n`.repeat(1025)}\ndata: {"type":"error","code":"insufficient_quota"}\n\n`;
		await consume(guard, new TextEncoder().encode(text), 65_536);
		await expect(guard.acquire(attempt)).rejects.toMatchObject({ reason: 'quota' });
	});


	it('does not mistake an oversized valid event followed by completion for recovery', async () => {
		const guard = await recovery();
		const text = `data: {"type":"response.output_text.delta","delta":"${'x'.repeat(1_048_577)}"}\n\n${completion}`;
		await consume(guard, new TextEncoder().encode(text), 65_536);
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
	});

	it.each([200, 503])('requires a consumed successful body rather than SSE headers on HTTP %i', async status => {
		const guard = await recovery();
		const response = await guard.transport(attempt, async () => new Response(null, { status, headers: { 'content-type': 'text/event-stream' } }))('https://synthetic.invalid');
		expect(await response.text()).toBe('');
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
	});

	it('does not recover from completion data delivered with a failed HTTP status', async () => {
		const guard = await recovery();
		const response = await guard.transport(attempt, async () => new Response(completion, { status: 503, headers: { 'content-type': 'text/event-stream' } }))('https://synthetic.invalid');
		expect(await response.text()).toBe(completion);
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
	});

	it('propagates cancellation and retains the bounded probe rather than asserting recovery', async () => {
		const guard = await recovery();
		const cancel = vi.fn();
		const response = await guard.transport(attempt, async () => streamResponse(new TextEncoder().encode(completion), 1, cancel))('https://synthetic.invalid');
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel('consumer stopped');
		expect(cancel).toHaveBeenCalledWith('consumer stopped');
		await expect(guard.acquire(attempt)).rejects.toBeInstanceOf(AIProviderDeferredError);
	});
});
