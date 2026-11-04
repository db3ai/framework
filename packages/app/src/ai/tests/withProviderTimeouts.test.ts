import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER, AIProviderRetryError, AIProviderTimeoutError, AIProviderTransport, isFailoverableFailure, type AIProviderAttempt } from '@db3.ai/app/ai';
import { withProviderTimeouts } from '../withProviderTimeouts';

const attempt: AIProviderAttempt = { provider: AI_PROVIDER.openai, apiKey: 'synthetic', baseUrl: 'https://synthetic.invalid/v1', model: 'test', supportsResponsesApi: true };
const url = 'https://synthetic.invalid/v1/responses';
const limits = { responseStartMs: 40, streamIdleMs: 60 };
const sse = { headers: { 'content-type': 'text/event-stream' } };

/** Waits like a provider that never sends headers, until the request is aborted. */
const neverResponds: typeof fetch = (_url, init) => new Promise((_, reject) => {
	init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
});

/** Streams `count` chunks `gapMs` apart, then either closes or goes silent. */
function chunks(count: number, gapMs: number, end: 'close' | 'stall'): Response {
	let sent = 0;
	return new Response(new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (sent >= count) {
				if (end === 'close') controller.close();
				else await new Promise(() => {});
				return;
			}
			if (sent > 0) await new Promise(resolve => setTimeout(resolve, gapMs));
			sent += 1;
			controller.enqueue(new TextEncoder().encode(`data: {"n":${sent}}\n\n`));
		},
	}), sse);
}

/** Reads a whole response, returning the chunks seen and any failure. */
async function drain(response: Response): Promise<{ chunks: number; error: unknown }> {
	const reader = response.body!.getReader();
	let seen = 0;
	try {
		for (;;) {
			const item = await reader.read();
			if (item.done) return { chunks: seen, error: null };
			seen += 1;
		}
	} catch (error) { return { chunks: seen, error }; }
}

describe('provider time limits', () => {
	it('names a response that never starts', async () => {
		const onTimeout = vi.fn();
		const error = await withProviderTimeouts(neverResponds, { ...limits, onTimeout })(url).catch(caught => caught);
		expect(error).toBeInstanceOf(AIProviderTimeoutError);
		expect(error).toMatchObject({ kind: 'response_start', code: 'ai_provider_response_start_timeout', timeoutMs: 40, message: 'AI provider did not start responding within 40ms.' });
		expect(onTimeout).toHaveBeenCalledExactlyOnceWith(error);
	});

	it('fails even when the transport ignores the abort signal', async () => {
		const error = await withProviderTimeouts(() => new Promise(() => {}), limits)(url).catch(caught => caught);
		expect(error).toMatchObject({ code: 'ai_provider_response_start_timeout' });
	});

	it('stops counting the response-start limit once headers arrive', async () => {
		const response = await withProviderTimeouts(async () => chunks(4, 30, 'close'), limits)(url);
		expect(await drain(response)).toEqual({ chunks: 4, error: null });
	});

	it('lets an active stream run far past every per-gap limit', async () => {
		const response = await withProviderTimeouts(async () => chunks(8, 30, 'close'), limits)(url);
		const started = Date.now();
		expect(await drain(response)).toEqual({ chunks: 8, error: null });
		expect(Date.now() - started).toBeGreaterThan(limits.streamIdleMs);
	});

	it('names a stream that goes silent', async () => {
		const onTimeout = vi.fn();
		const response = await withProviderTimeouts(async () => chunks(2, 5, 'stall'), { ...limits, onTimeout })(url);
		const result = await drain(response);
		expect(result.chunks).toBe(2);
		expect(result.error).toBeInstanceOf(AIProviderTimeoutError);
		expect(result.error).toMatchObject({ kind: 'stream_idle', code: 'ai_provider_stream_idle_timeout', message: 'AI provider stream stalled: no data received for 60ms.' });
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it('does not blame the provider for a slow reader', async () => {
		const response = await withProviderTimeouts(async () => chunks(2, 0, 'close'), limits)(url);
		const reader = response.body!.getReader();
		await reader.read();
		await new Promise(resolve => setTimeout(resolve, limits.streamIdleMs * 2));
		expect((await reader.read()).done).toBe(false);
		expect((await reader.read()).done).toBe(true);
	});

	it('applies the optional overall limit to an active stream', async () => {
		const response = await withProviderTimeouts(async () => chunks(100, 20, 'close'), { ...limits, totalMs: 90 })(url);
		const result = await drain(response);
		expect(result.chunks).toBeGreaterThan(0);
		expect(result.error).toMatchObject({ kind: 'total', code: 'ai_provider_total_timeout', message: 'AI provider request exceeded its overall limit of 90ms.' });
	});

	it('keeps caller cancellation distinct from a timeout', async () => {
		const caller = new AbortController();
		const pending = withProviderTimeouts(neverResponds, limits)(url, { signal: caller.signal }).catch(caught => caught);
		caller.abort(new DOMException('Stopped.', 'AbortError'));
		const error = await pending;
		expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
		expect(error).toMatchObject({ name: 'AbortError' });
	});

	it('cancels the provider body when the caller stops reading', async () => {
		const cancel = vi.fn();
		const source = new Response(new ReadableStream<Uint8Array>({ cancel }), sse);
		const response = await withProviderTimeouts(async () => source, limits)(url);
		await response.body!.cancel('done');
		expect(cancel).toHaveBeenCalledWith('done');
	});

	it('passes through a response without a body', async () => {
		const response = await withProviderTimeouts(async () => new Response(null, { status: 204 }), limits)(url);
		expect(response.status).toBe(204);
	});
});

describe('provider timeouts in the transport', () => {
	it('turns a response-start timeout into a named retry that survives SDK wrapping', async () => {
		const transport = new AIProviderTransport();
		const failure = await transport.transport(attempt, withProviderTimeouts(neverResponds, limits))(url).catch(caught => caught);
		expect(failure).toBeInstanceOf(AIProviderRetryError);
		expect(failure).toMatchObject({ providerCode: 'ai_provider_response_start_timeout', message: 'AI provider did not start responding within 40ms.' });
		expect(isFailoverableFailure(failure)).toBe(true);
		expect(transport.requestFailure(attempt, new Error('SDK connection error'))).toBe(failure);
	});

	it('turns a stalled stream into a named retry', async () => {
		const transport = new AIProviderTransport();
		const response = await transport.transport(attempt, withProviderTimeouts(async () => chunks(1, 0, 'stall'), limits))(url);
		const result = await drain(response);
		expect(result.error).toBeInstanceOf(AIProviderRetryError);
		expect(result.error).toMatchObject({ providerCode: 'ai_provider_stream_idle_timeout', message: 'AI provider stream stalled: no data received for 60ms.' });
	});
});
