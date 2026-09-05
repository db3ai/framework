import { describe, expect, it, vi } from 'vitest';
import { OpenAIText, TextGenerationError } from '@db3.ai/app/ai';

const request = { input: 'A private note.', instructions: 'Summarise the note.', maxOutputTokens: 400 };

/** Returns a minimal external Responses payload; framework code is exercised unchanged. */
function response(overrides: Record<string, unknown> = {}) {
	return Response.json({ object: 'response', id: 'resp_test', model: 'test-model', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A summary.' }] }], usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 }, ...overrides });
}

describe('OpenAIText public API', () => {
	it('uses explicit credentials, bounded stateless requests and provider usage', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response());
		const client = new OpenAIText({ apiKey: 'dummy-test-key', model: 'test-model', fetch });
		expect(await client.generate(request)).toEqual({ id: 'resp_test', model: 'test-model', text: 'A summary.', usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 } });
		const [url, init] = fetch.mock.calls[0];
		expect(String(url)).toBe('https://api.openai.com/v1/responses');
		expect(JSON.parse(init!.body as string)).toMatchObject({ store: false, input: request.input, instructions: request.instructions, max_output_tokens: 400 });
		expect(new Headers(init!.headers).get('authorization')).toBe('Bearer dummy-test-key');
	});
	it('requires a key and model instead of silently inheriting process credentials', () => {
		expect(() => new OpenAIText({ apiKey: '', model: 'test' })).toThrow(TextGenerationError);
		expect(() => new OpenAIText({ apiKey: 'test', model: ' ' })).toThrow(TextGenerationError);
	});
	it('validates input and token bounds before making a request', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const client = new OpenAIText({ apiKey: 'test', model: 'test', fetch });
		for (const invalid of [{ input: ' ' }, { maxOutputTokens: 0 }, { maxOutputTokens: 400.2 }, { instructions: '' }]) await expect(client.generate({ ...request, ...invalid })).rejects.toMatchObject({ code: 'invalid_input' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it.each([429, 401, 500])('does not retry %s or expose provider error content', async status => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: { message: 'private prompt and secret key' } }, { status }));
		const client = new OpenAIText({ apiKey: 'test', model: 'test', fetch });
		await expect(client.generate(request)).rejects.toMatchObject({ code: status === 429 ? 'rate_limit' : 'provider' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it.each([{ status: 'incomplete' }, { output: [] }, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Refused' }] }] }])('rejects incomplete, empty or refused output', async override => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(override));
		await expect(new OpenAIText({ apiKey: 'test', model: 'test', fetch }).generate(request)).rejects.toMatchObject({ code: 'incomplete' });
	});
	it('represents missing usage as unknown, not zero', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ usage: null }));
		expect((await new OpenAIText({ apiKey: 'test', model: 'test', fetch }).generate(request)).usage).toBeNull();
	});
	it('does not return partial text alongside a provider refusal', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Some text' }, { type: 'refusal', refusal: 'No' }] }] }));
		await expect(new OpenAIText({ apiKey: 'test', model: 'test', fetch }).generate(request)).rejects.toMatchObject({ code: 'incomplete' });
	});
	it('honours cancellation without calling the provider', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const signal = AbortSignal.abort();
		await expect(new OpenAIText({ apiKey: 'test', model: 'test', fetch }).generate({ ...request, signal })).rejects.toMatchObject({ code: 'cancelled' });
		expect(fetch).not.toHaveBeenCalled();
	});
	it('bounds provider time and returns a safe timeout classification', async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
			init!.signal!.addEventListener('abort', () => reject(new DOMException('Transport aborted', 'AbortError')), { once: true });
		}));
		await expect(new OpenAIText({ apiKey: 'test', model: 'test', timeoutMs: 10, fetch }).generate(request)).rejects.toMatchObject({ code: 'timeout' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
