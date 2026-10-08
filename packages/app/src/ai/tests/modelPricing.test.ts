import { describe, expect, it } from 'vitest';
import {
	AI_IMAGE_MODEL_PRICING,
	AI_MODEL_PRICING,
	calculateAIHostedToolCost,
	calculateAIHostedToolCostUSD,
	calculateAIImageRequestCostUSD,
	calculateAIRequestEntriesCostUSD,
	calculateAIRequestCostUSD,
	combineAIRequestCostUSD,
} from '@db3.ai/app/ai';

describe('AI model pricing', () => {
	it('prices tiers per request, including cached and long-context tokens', () => {
		const usage = { inputTokens: 300_000, cachedTokens: 100_000, outputTokens: 10_000 };
		expect(calculateAIRequestCostUSD('gpt-5.6-sol', { ...usage, serviceTier: 'flex' })).toBe(0.99);
		expect(calculateAIRequestCostUSD('gpt-5.6-sol', { ...usage, serviceTier: 'fast' })).toBe(3.96);
		expect(calculateAIRequestCostUSD('gpt-5.6-sol', { ...usage, serviceTier: null })).toBeNull();
		expect(calculateAIRequestCostUSD('gpt-4.1-mini', { ...usage, serviceTier: 'flex' })).toBeNull();
		expect(calculateAIRequestEntriesCostUSD('gpt-6-sol', [
			{ ...usage, model: 'gpt-5.6-sol', serviceTier: 'flex' },
			{ ...usage, model: 'gpt-5.6-sol', serviceTier: 'default' },
		])).toBe(2.97);
	});

	it('prices the default GPT-4.1 mini model and dated snapshots with cached input discounts', () => {
		for (const model of ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14']) {
			expect(calculateAIRequestCostUSD(model, { inputTokens: 200, cachedTokens: 60, outputTokens: 30 })).toBe(0.00011);
		}
	});
	it('defines hardcoded OpenAI model pricing per 1M tokens', () => {
		expect(AI_MODEL_PRICING['gpt-5.6-sol']).toEqual({
			serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
			inputUSDPer1M: 4.00,
			cachedInputUSDPer1M: 0.40,
			outputUSDPer1M: 20.00,
			cacheWriteInputMultiplier: 1.25,
			longContextInputTokenThreshold: 272_000,
			longContextInputMultiplier: 2,
			longContextOutputMultiplier: 1.5,
		});
		expect(AI_MODEL_PRICING['gpt-5.6-terra']).toEqual({
			serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
			inputUSDPer1M: 2.00,
			cachedInputUSDPer1M: 0.20,
			outputUSDPer1M: 12.00,
			cacheWriteInputMultiplier: 1.25,
			longContextInputTokenThreshold: 272_000,
			longContextInputMultiplier: 2,
			longContextOutputMultiplier: 1.5,
		});
		expect(AI_MODEL_PRICING['gpt-5.6-luna']).toEqual({
			serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
			inputUSDPer1M: 0.20,
			cachedInputUSDPer1M: 0.02,
			outputUSDPer1M: 1.20,
			cacheWriteInputMultiplier: 1.25,
			longContextInputTokenThreshold: 272_000,
			longContextInputMultiplier: 2,
			longContextOutputMultiplier: 1.5,
		});
		expect(AI_MODEL_PRICING['gpt-5.4-nano']).toEqual({
			inputUSDPer1M: 0.20,
			cachedInputUSDPer1M: 0.02,
			outputUSDPer1M: 1.25,
		});
		expect(AI_MODEL_PRICING['gpt-5.5']).toEqual({
			inputUSDPer1M: 5.00,
			cachedInputUSDPer1M: 0.50,
			outputUSDPer1M: 30.00,
			longContextInputTokenThreshold: 272_000,
			longContextInputMultiplier: 2,
			longContextOutputMultiplier: 1.5,
		});
		expect(AI_MODEL_PRICING['text-embedding-3-small']).toEqual({
			inputUSDPer1M: 0.02,
			cachedInputUSDPer1M: null,
			outputUSDPer1M: null,
		});
		expect(AI_IMAGE_MODEL_PRICING['gpt-image-2']).toEqual({
			textInputUSDPer1M: 5.00,
			cachedTextInputUSDPer1M: 1.25,
			imageInputUSDPer1M: 8.00,
			cachedImageInputUSDPer1M: 2.00,
			imageOutputUSDPer1M: 30.00,
		});
	});

	it('calculates request cost from input, cached input, and output tokens', () => {
		expect(calculateAIRequestCostUSD('gpt-5.6-terra', {
			inputTokens: 200,
			cachedTokens: 60,
			outputTokens: 30,
		})).toBe(0.000652);
		expect(calculateAIRequestCostUSD('gpt-5.4-nano', {
			inputTokens: 200,
			cachedTokens: 60,
			outputTokens: 30,
		})).toBe(0.0000667);
	});

	it('prices billable GPT-5.6 prompt-cache writes separately', () => {
		expect(calculateAIRequestCostUSD('gpt-5.6-terra', {
			inputTokens: 200,
			cachedTokens: 60,
			cacheWriteTokens: 40,
			outputTokens: 30,
		})).toBe(0.000672);
	});

	it('bills cached tokens at the input rate when a model has no cached input price', () => {
		expect(calculateAIRequestCostUSD('gpt-5.5-pro', {
			inputTokens: 100,
			cachedTokens: 40,
			outputTokens: 10,
		})).toBe(0.0048);
	});

	it('applies long-context pricing to each individual agent model request', () => {
		expect(calculateAIRequestCostUSD('gpt-5.6-sol', {
			inputTokens: 300_000,
			cachedTokens: 100_000,
			outputTokens: 10_000,
		})).toBe(1.98);
		expect(calculateAIRequestEntriesCostUSD('gpt-5.6-sol', [
			{
				inputTokens: 10,
				cachedTokens: 0,
				outputTokens: 4,
				endpoint: 'responses.create',
			},
			{
				inputTokens: 300_000,
				cachedTokens: 100_000,
				outputTokens: 10_000,
				endpoint: 'responses.create',
			},
		])).toBe(1.98012);
	});

	it.each([
		['gpt-6-astra', 0.00306],
		['gpt-6-sol', 0.000612],
		['gpt-6-luna', 0.0000306],
		['gpt-5.6-sol', 0.001224],
	])('prices %s input, cache reads, cache writes and output at current Standard rates', (model, expectedCost) => {
		expect(calculateAIRequestCostUSD(model, {
			inputTokens: 200,
			cachedTokens: 60,
			cacheWriteTokens: 40,
			outputTokens: 30,
		})).toBe(expectedCost);
	});

	it.each([
		['gpt-6-astra', 272_000, 2.37],
		['gpt-6-astra', 272_001, 4.49002],
		['gpt-6-sol', 272_000, 0.474],
		['gpt-6-sol', 272_001, 0.898004],
		['gpt-6-luna', 272_000, 0.0237],
		['gpt-6-luna', 272_001, 0.0449002],
	] as const)('prices %s at the correct context tier for %i input tokens', (model, inputTokens, expectedCost) => {
		expect(calculateAIRequestCostUSD(model, {
			inputTokens,
			cachedTokens: 100_000,
			cacheWriteTokens: 20_000,
			outputTokens: 10_000,
		})).toBe(expectedCost);
	});

	it.each([
		['gpt-6-astra', 3.1],
		['gpt-6-sol', 0.62],
		['gpt-6-luna', 0.031],
	])('keeps separate short %s requests at Standard rates when the run exceeds 272K tokens', (model, expectedCost) => {
		expect(calculateAIRequestEntriesCostUSD(model, [
			{ inputTokens: 150_000, outputTokens: 1_000 },
			{ inputTokens: 150_000, outputTokens: 1_000 },
		])).toBe(expectedCost);
	});

	it('resolves current aliases and dated snapshots to one rate card', () => {
		const usage = {
			inputTokens: 100,
			cachedTokens: 0,
			outputTokens: 10,
		};

		expect(calculateAIRequestCostUSD('gpt-5.6', usage)).toBe(
			calculateAIRequestCostUSD('gpt-5.6-sol', usage),
		);
		expect(calculateAIRequestCostUSD('gpt-5.6-terra-2026-07-01', usage)).toBe(
			calculateAIRequestCostUSD('gpt-5.6-terra', usage),
		);
	});

	it('calculates input-only embedding request cost without output tokens', () => {
		expect(calculateAIRequestCostUSD('text-embedding-3-small', {
			inputTokens: 92,
			outputTokens: null,
		})).toBe(0.00000184);
	});

	it.each(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08'])('calculates %s image cost from text, image, cached, and output tokens', model => {
		expect(calculateAIImageRequestCostUSD(model, {
			inputTextTokens: 20,
			cachedTextTokens: 4,
			inputImageTokens: 10,
			cachedImageTokens: 2,
			outputImageTokens: 1000,
		})).toBe(0.030153);
	});

	it('keeps Flare requests unpriced when required image usage is missing', () => {
		expect(calculateAIImageRequestCostUSD('gpt-image-2.5-flare', {
			inputTextTokens: 20,
			inputImageTokens: 0,
			outputImageTokens: null,
		})).toBeNull();
	});

	it('adds billable hosted web searches to the model request cost', () => {
		const hostedToolCostUSD = calculateAIHostedToolCostUSD({
			web_search_call: 6,
			unpriced_hosted_tool: 4,
		});

		expect(hostedToolCostUSD).toBe(0.06);
		expect(combineAIRequestCostUSD(1.2295115, hostedToolCostUSD)).toBe(1.2895115);
		expect(combineAIRequestCostUSD(null, hostedToolCostUSD)).toBeNull();
	});

	it('marks completed hosted tools without a pricing rule as unpriced', () => {
		expect(calculateAIHostedToolCost({
			web_search_call: 2,
			image_generation_call: 1,
		})).toEqual({
			costUSD: 0.02,
			unpricedUsage: {
				image_generation_call: 1,
			},
		});
	});

	it('returns null when pricing or required usage is unavailable', () => {
		expect(calculateAIRequestCostUSD('test-model', {
			inputTokens: 100,
			cachedTokens: 0,
			outputTokens: 10,
		})).toBeNull();
		expect(calculateAIRequestCostUSD('gpt-5.4-nano', {
			inputTokens: 100,
			outputTokens: null,
		})).toBeNull();
		expect(calculateAIImageRequestCostUSD('gpt-image-2', {
			inputTextTokens: 20,
			inputImageTokens: null,
			outputImageTokens: 1000,
		})).toBeNull();
	});
});
