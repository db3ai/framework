import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER, AIProviderRetryError, AIProviderTransport, AIProviderStoppedError, type AIProviderAttempt } from '@db3.ai/app/ai';

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

/** Consumes the wrapped transport and proves that the SDK receives the exact input bytes. */
async function consume(guard: AIProviderTransport, bytes: Uint8Array, chunkSize = 1): Promise<void> {
	const response = await guard.transport(attempt, async () => streamResponse(bytes, chunkSize))('https://synthetic.invalid');
	expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
}

describe('request-local provider SSE observation', () => {
	it.each(['\n', '\r', '\r\n'])('joins data fields and handles every-byte UTF-8 and %j fragmentation', async newline => {
		const guard = new AIProviderTransport();
		const text = [': heartbeat', 'event: response.output_text.delta', 'data: {"type":"response.output_text.delta","delta":"Café 🌍"}', '', 'data: {"type":"response.completed",', 'data: "response":{"status":"completed"}}', '', ''].join(newline);
		await consume(guard, new TextEncoder().encode(text));
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it('retains SSE support identity and recognized failure code without treating HTTP 200 as a rejection', async () => {
		const guard = new AIProviderTransport();
		const response = await guard.transport(attempt, async () => new Response('data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"PRIVATE customer text"}}}\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_sse_outage' } }))('https://synthetic.invalid');
		await expect(response.text()).rejects.toBeInstanceOf(AIProviderRetryError);
		const error = guard.requestFailure(attempt, null);
		expect(error).toMatchObject({ providerCode: 'server_error', diagnostics: { status: null, requestId: 'req_sse_outage' } });
		expect(JSON.stringify(error)).not.toContain('PRIVATE');
	});

	it('retains the support request ID when an SSE body fails during transport', async () => {
		const guard = new AIProviderTransport();
		const body = new ReadableStream<Uint8Array>({
			/** Simulates a provider connection failure after response headers arrived. */
			pull(controller) { controller.error(Object.assign(new Error('PRIVATE provider text'), { code: 'ECONNRESET' })); },
		});
		const response = await guard.transport(attempt, async () => new Response(body, { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_transport_outage' } }))('https://synthetic.invalid');
		await expect(response.text()).rejects.toMatchObject({ providerCode: 'ECONNRESET', diagnostics: { status: null, requestId: 'req_transport_outage' } });
	});

	it('accepts a fully framed compatible DONE marker after valid data', async () => {
		const guard = new AIProviderTransport();
		await consume(guard, new TextEncoder().encode('data: {"choices":[]}\n\ndata: [DONE]\n\n'));
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it.each([1, 2, 7, 1024])('detects later multiline quota after malformed data with %i-byte chunks', async chunkSize => {
		const guard = new AIProviderTransport();
		const text = 'data: {malformed}\r\n\r\ndata: {"type":"response.failed",\r\ndata: "response":{"error":{"code":"insufficient_quota","message":"Crédits 🌍"}}}\r\n\r\n';
		await expect(consume(guard, new TextEncoder().encode(text), chunkSize)).rejects.toBeInstanceOf(AIProviderStoppedError);
		expect(guard.requestFailure(attempt, null)).toBeInstanceOf(AIProviderStoppedError);
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
	])('passes through malformed or incomplete input without fabricating an account stop %j', async text => {
		const guard = new AIProviderTransport();
		await consume(guard, new TextEncoder().encode(text));
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it('flushes incomplete UTF-8 at EOF without changing delivered bytes', async () => {
		const guard = new AIProviderTransport();
		const completeBytes = new TextEncoder().encode(completion);
		const bytes = new Uint8Array(completeBytes.length + 1);
		bytes.set(completeBytes); bytes[bytes.length - 1] = 0xc3;
		await consume(guard, bytes);
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it('bounds oversized joined events and lines while still observing a later quota event', async () => {
		const guard = new AIProviderTransport();
		const text = `data: ${'x'.repeat(1_048_577)}\n\n${`data: ${'x'.repeat(1024)}\n`.repeat(1025)}\ndata: {"type":"error","code":"insufficient_quota"}\n\n`;
		await expect(consume(guard, new TextEncoder().encode(text), 65_536)).rejects.toBeInstanceOf(AIProviderStoppedError);
		expect(guard.requestFailure(attempt, null)).toMatchObject({ reason: 'quota' });
	});


	it('bounds observation without changing oversized provider events', async () => {
		const guard = new AIProviderTransport();
		const text = `data: {"type":"response.output_text.delta","delta":"${'x'.repeat(1_048_577)}"}\n\n${completion}`;
		await consume(guard, new TextEncoder().encode(text), 65_536);
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it.each([200, 503])('leaves empty SSE responses available to the SDK on HTTP %i', async status => {
		const guard = new AIProviderTransport();
		const response = await guard.transport(attempt, async () => new Response(null, { status, headers: { 'content-type': 'text/event-stream' } }))('https://synthetic.invalid');
		expect(await response.text()).toBe('');
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it('preserves completion bytes delivered with a failed HTTP status', async () => {
		const guard = new AIProviderTransport();
		const response = await guard.transport(attempt, async () => new Response(completion, { status: 503, headers: { 'content-type': 'text/event-stream' } }))('https://synthetic.invalid');
		expect(await response.text()).toBe(completion);
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});

	it('propagates cancellation to only the current response', async () => {
		const guard = new AIProviderTransport();
		const cancel = vi.fn();
		const response = await guard.transport(attempt, async () => streamResponse(new TextEncoder().encode(completion), 1, cancel))('https://synthetic.invalid');
		const reader = response.body!.getReader();
		await reader.read();
		await reader.cancel('consumer stopped');
		expect(cancel).toHaveBeenCalledWith('consumer stopped');
		expect(guard.requestFailure(attempt, null)).toBeNull();
	});
});
