import { describe, expect, it } from 'vitest';
import { providerReportedCost, providerReportedCostUSD, summarizeProviderReportedCosts } from '@db3.ai/app/ai';

describe('AI provider-reported costs', () => {
	it('reads OpenRouter request cost in USD, including zero', () => {
		expect(providerReportedCostUSD('openrouter', {
			usage: { cost: 0.0042 },
		})).toBe(0.0042);
		expect(providerReportedCostUSD('openrouter', {
			usage: { cost: 0 },
		})).toBe(0);
	});

	it('converts xAI USD ticks to stored USD precision', () => {
		expect(providerReportedCostUSD('xai', {
			usage: { cost_in_usd_ticks: '42000000' },
		})).toBe(0.0042);
	});

	it('rejects absent, negative, and malformed provider costs', () => {
		expect(providerReportedCostUSD('openrouter', { usage: {} })).toBeNull();
		expect(providerReportedCostUSD('openrouter', { usage: { cost: -1 } })).toBeNull();
		expect(providerReportedCostUSD('openrouter', { usage: { cost: 'unknown' } })).toBeNull();
		expect(providerReportedCostUSD('openai', { usage: { cost: 0.0042 } })).toBeNull();
	});

	it('only returns an exact agent total when every expected request is covered', () => {
		const first = providerReportedCost('openrouter', { usage: { cost: 0.003 } }, 'resp_1');
		const second = providerReportedCost('openrouter', { usage: { cost: 0.004 } }, 'resp_2');

		expect(first).not.toBeNull();
		expect(second).not.toBeNull();

		const costs = new Map([
			[first!.responseId, first!],
			[second!.responseId, second!],
		]);

		expect(summarizeProviderReportedCosts(costs, 2)).toEqual({
			knownCostUSD: 0.007,
			costUSD: 0.007,
			reportedRequestCount: 2,
			expectedRequestCount: 2,
			sources: ['openrouter_usage_cost'],
		});
		expect(summarizeProviderReportedCosts(costs, 3)).toMatchObject({
			knownCostUSD: 0.007,
			costUSD: null,
		});
	});
});
