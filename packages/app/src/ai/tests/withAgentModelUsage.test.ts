import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { Agent, OpenAIProvider, Runner, Usage } from '@openai/agents';
import { withAgentModelUsage } from '../withAgentModelUsage';

/** Supplies the provider's nested cache breakdown through the real OpenAI adapter. */
function providerResponse(stream: boolean): Response {
	const response = {
		id: 'resp_usage', object: 'response', created_at: 1, model: 'test-model', status: 'completed',
		output: [{ type: 'message', id: 'msg_usage', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }],
		usage: {
			input_tokens: 200, output_tokens: 30, total_tokens: 230,
			input_tokens_details: { cached_tokens: 60, cache_write_tokens: 40, cache_write_tokens_details: { ttl_12h_tokens: 10, ttl_30m_tokens: 30 } },
			output_tokens_details: { reasoning_tokens: 20, future_details: { nested: 20 } },
		},
	};
	return stream
		? new Response('data: '+JSON.stringify({ type: 'response.completed', sequence_number: 0, response })+'\n\n', { headers: { 'content-type': 'text/event-stream' } })
		: Response.json(response);
}

describe('withAgentModelUsage', () => {
	it.each([false, true])('completes a real SDK run with nested provider usage (stream=%s)', async stream => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(providerResponse(stream));
		const provider = new OpenAIProvider({ openAIClient: new OpenAI({ apiKey: 'synthetic', fetch, maxRetries: 0 }), useResponses: true });
		const runner = new Runner({ tracingDisabled: true, modelProvider: {
			/** Exercises the same normalization boundary used by the framework provider. */
			async getModel(name) { return withAgentModelUsage(await provider.getModel(name)); },
		} });
		const agent = new Agent({ name: 'UsageTest', model: 'test-model', instructions: 'Answer.' });
		const result = await runner.run(agent, 'Hello.', { stream });
		if ('completed' in result) await result.completed;
		expect(result.finalOutput).toBe('Done.');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(result.runContext.usage).toMatchObject({ requests: 1, inputTokens: 200, outputTokens: 30, totalTokens: 230, inputTokensDetails: [{ cached_tokens: 60, cache_write_tokens: 40 }], outputTokensDetails: [{ reasoning_tokens: 20 }], requestUsageEntries: [{ inputTokensDetails: { cached_tokens: 60, cache_write_tokens: 40 }, outputTokensDetails: { reasoning_tokens: 20 }, endpoint: 'responses.create' }] });
		expect(result.rawResponses[0]!.usage).toBeInstanceOf(Usage);
		expect(() => result.state.toJSON()).not.toThrow();
		if (!stream) expect(result.rawResponses[0]!.providerData?.usage.input_tokens_details.cache_write_tokens_details).toEqual({ ttl_12h_tokens: 10, ttl_30m_tokens: 30 });
	});
});
