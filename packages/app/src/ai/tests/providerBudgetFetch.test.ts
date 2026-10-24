import { describe, expect, it } from 'vitest';
import { providerBudgetFetch } from '../providerBudgetFetch.js';
import type { AIProviderBudgetInput, AIProviderBudgetResult } from '../contracts/AIProviderBudget.js';

const context: Omit<AIProviderBudgetInput, 'request'> = { provider: 'openai', model: 'gpt-6-sol', operation: 'agents.run.attempt', aiRequest: null, rootAiRequest: null };

describe('provider budget HTTP lifecycle', () => {
	it('reserves every HTTP call before external work and applies bounded replacement requests', async () => {
		const events: string[] = [];
		let sent = '';
		const response = await providerBudgetFetch(async (_url, init) => { events.push('provider'); sent = String(init?.body); return Response.json({ usage: { input_tokens: 3, output_tokens: 2 } }); }, 'https://provider.test/responses', { body: JSON.stringify({ model: 'gpt-6-sol', max_output_tokens: 20_000 }) }, context, async input => { events.push('reserve'); return { request: { ...input.request, max_output_tokens: 400 }, async settle(result) { events.push('settle'); expect(result.payload?.usage).toEqual({ input_tokens: 3, output_tokens: 2 }); } }; });
		expect(response.status).toBe(200);
		expect(JSON.parse(sent).max_output_tokens).toBe(400);
		expect(events).toEqual(['reserve', 'provider', 'settle']);
	});
	it('observes split SSE terminal usage without consuming or changing provider bytes', async () => {
		const body = 'data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":30,"output_tokens":4}}}\n\n';
		const bytes = new TextEncoder().encode(body);
		const results: AIProviderBudgetResult[] = [];
		const response = await providerBudgetFetch(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 37)); controller.enqueue(bytes.slice(37)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }), 'https://provider.test/responses', { body: '{}' }, context, async () => ({ async settle(result) { results.push(result); } }));
		expect(await response.text()).toBe(body);
		expect(results).toEqual([{ status: 200, uncertain: false, payload: { status: 'completed', usage: { input_tokens: 30, output_tokens: 4 } } }]);
	});
	it('reports transport cancellation and missing terminal usage as uncertain once', async () => {
		const results: AIProviderBudgetResult[] = [];
		await expect(providerBudgetFetch(async () => { throw new Error('network lost'); }, 'https://provider.test/responses', { body: '{}' }, context, async () => ({ async settle(result) { results.push(result); } }))).rejects.toThrow('network lost');
		expect(results).toEqual([{ status: null, payload: null, uncertain: true }]);
	});
	it('uses the actual wire model for pricing and releases an already-cancelled request without dispatch', async () => {
		let calls = 0;
		let model = '';
		const results: AIProviderBudgetResult[] = [];
		const controller = new AbortController();
		controller.abort(new Error('stopped'));
		await expect(providerBudgetFetch(async () => { calls++; return Response.json({}); }, 'https://provider.test/responses', { body: JSON.stringify({ model: 'gpt-6-astra' }), signal: controller.signal }, context, async input => { model = input.model; return { async settle(result) { results.push(result); } }; })).rejects.toThrow('stopped');
		expect(model).toBe('gpt-6-astra');
		expect(calls).toBe(0);
		expect(results[0]).toMatchObject({ status: 499, uncertain: false });
	});
	it('never dispatches a refused reservation', async () => {
		let calls = 0;
		await expect(providerBudgetFetch(async () => { calls++; return Response.json({}); }, 'https://provider.test/responses', { body: '{}' }, context, async () => { throw new Error('exhausted'); })).rejects.toThrow('exhausted');
		expect(calls).toBe(0);
	});
});
