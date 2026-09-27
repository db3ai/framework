import { describe, expect, it } from 'vitest';
import { estimateTokensFromText, estimateTokensFromWords } from '@db3.ai/app/ai';
import { calculateAIRequestCostUSD } from '@db3.ai/app/ai';

describe('AI usage estimates', () => {
	it('estimates tokens from complete provider text', () => {
		expect(estimateTokensFromText('')).toBe(1);
		expect(estimateTokensFromText('1234')).toBe(1);
		expect(estimateTokensFromText('12345')).toBe(2);
	});

	it('estimates tokens from a word count when source text is unavailable', () => {
		expect(estimateTokensFromWords(750)).toBe(1000);
		expect(estimateTokensFromWords(1)).toBe(2);
		expect(estimateTokensFromWords(0)).toBe(0);
		expect(estimateTokensFromWords(-10)).toBe(0);
		expect(estimateTokensFromWords(Number.NaN)).toBe(0);
	});

	it('uses estimated tokens with the existing model pricing helper', () => {
		const inputTokens = estimateTokensFromWords(750);
		const outputTokens = 200;
		const nanoCost = calculateAIRequestCostUSD('gpt-5.4-nano', {
			inputTokens,
			outputTokens,
			cachedTokens: 0,
		});
		const terraCost = calculateAIRequestCostUSD('gpt-5.6-terra', {
			inputTokens,
			outputTokens,
			cachedTokens: 0,
		});

		expect(nanoCost).toBe(0.00045);
		expect(terraCost).toBe(0.0044);
		expect(terraCost).toBeGreaterThan(nanoCost ?? 0);
	});
});
