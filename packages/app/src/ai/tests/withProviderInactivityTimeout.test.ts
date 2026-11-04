import { describe, expect, it, vi } from 'vitest';
import { AI_PROVIDER, AIProviderRetryError, AIProviderTimeoutError, AIProviderTransport, isFailoverableFailure, type AIProviderAttempt } from '@db3.ai/app/ai';
import { withProviderInactivityTimeout } from '../withProviderInactivityTimeout';

const attempt: AIProviderAttempt = { provider: AI_PROVIDER.openai, apiKey: 'synthetic', baseUrl: 'https://synthetic.invalid/v1', model: 'test', supportsResponsesApi: true };
const url = 'https://synthetic.invalid/v1/responses';
const limit = 60;
const stuck = { code: 'ai_provider_inactivity_timeout', timeoutMs: limit, message: 'AI provider sent nothing for 60ms; the request appears stuck.' };
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

describe('provider inactivity timeout', () => {
	it('names a response that never starts', async () => {
		const onTimeout = vi.fn();
		const error = await withProviderInactivityTimeout(neverResponds, limit, onTimeout)(url).catch(caught => caught);
		expect(error).toBeInstanceOf(AIProviderTimeoutError);
		expect(error).toMatchObject(stuck);
		expect(onTimeout).toHaveBeenCalledExactlyOnceWith(error);
	});

	it('fails even when the transport ignores the abort signal', async () => {
		const error = await withProviderInactivityTimeout(() => new Promise(() => {}), limit)(url).catch(caught => caught);
		expect(error).toMatchObject(stuck);
	});

	it('lets an active stream run far past the limit', async () => {
		const response = await withProviderInactivityTimeout(async () => chunks(8, 30, 'close'), limit)(url);
		const started = Date.now();
		expect(await drain(response)).toEqual({ chunks: 8, error: null });
		expect(Date.now() - started).toBeGreaterThan(limit * 2);
	});

	it('names a stream that goes silent', async () => {
		const onTimeout = vi.fn();
		const response = await withProviderInactivityTimeout(async () => chunks(2, 5, 'stall'), limit, onTimeout)(url);
		const result = await drain(response);
		expect(result.chunks).toBe(2);
		expect(result.error).toBeInstanceOf(AIProviderTimeoutError);
		expect(result.error).toMatchObject(stuck);
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it('holds no per-read state once a read completes, so long streams stay bounded', async () => {
		const added = vi.spyOn(AbortSignal.prototype, 'addEventListener');
		const removed = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
		try {
			const response = await withProviderInactivityTimeout(async () => chunks(50, 0, 'close'), limit)(url);
			expect(await drain(response)).toEqual({ chunks: 50, error: null });
			const aborts = (spy: typeof added | typeof removed) => spy.mock.calls.filter(([type]) => type === 'abort').length;
			expect(aborts(added)).toBeGreaterThanOrEqual(50);
			expect(aborts(removed)).toBe(aborts(added));
		} finally { added.mockRestore(); removed.mockRestore(); }
	});

	it('does not blame the provider for a slow reader', async () => {
		const response = await withProviderInactivityTimeout(async () => chunks(2, 0, 'close'), limit)(url);
		const reader = response.body!.getReader();
		await reader.read();
		await new Promise(resolve => setTimeout(resolve, limit * 2));
		expect((await reader.read()).done).toBe(false);
		expect((await reader.read()).done).toBe(true);
	});

	it('keeps caller cancellation distinct from a timeout', async () => {
		const caller = new AbortController();
		const pending = withProviderInactivityTimeout(neverResponds, limit)(url, { signal: caller.signal }).catch(caught => caught);
		caller.abort(new DOMException('Stopped.', 'AbortError'));
		const error = await pending;
		expect(error).not.toBeInstanceOf(AIProviderTimeoutError);
		expect(error).toMatchObject({ name: 'AbortError' });
	});

	it('cancels the provider body when the caller stops reading', async () => {
		const cancel = vi.fn();
		const source = new Response(new ReadableStream<Uint8Array>({ cancel }), sse);
		const response = await withProviderInactivityTimeout(async () => source, limit)(url);
		await response.body!.cancel('done');
		expect(cancel).toHaveBeenCalledWith('done');
	});

	it('passes through a response without a body', async () => {
		const response = await withProviderInactivityTimeout(async () => new Response(null, { status: 204 }), limit)(url);
		expect(response.status).toBe(204);
	});
});

describe('provider inactivity timeout in the transport', () => {
	it('turns a response that never starts into a named retry that survives SDK wrapping', async () => {
		const transport = new AIProviderTransport();
		const failure = await transport.transport(attempt, withProviderInactivityTimeout(neverResponds, limit))(url).catch(caught => caught);
		expect(failure).toBeInstanceOf(AIProviderRetryError);
		expect(failure).toMatchObject({ providerCode: stuck.code, message: stuck.message });
		expect(isFailoverableFailure(failure)).toBe(true);
		expect(transport.requestFailure(attempt, new Error('SDK connection error'))).toBe(failure);
	});

	it('turns a stalled stream into a named retry', async () => {
		const transport = new AIProviderTransport();
		const response = await transport.transport(attempt, withProviderInactivityTimeout(async () => chunks(1, 0, 'stall'), limit))(url);
		const result = await drain(response);
		expect(result.error).toBeInstanceOf(AIProviderRetryError);
		expect(result.error).toMatchObject({ providerCode: stuck.code, message: stuck.message });
	});
});
