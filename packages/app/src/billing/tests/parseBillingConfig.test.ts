import { describe, expect, it } from 'vitest';
import { BillingConfigError, parseBillingConfig } from '../index';
import { billingConfigJson } from './support/billingConfigJson';

describe('parseBillingConfig', () => {
	it('reads prices, credit packs and limits from db3/billing.json', () => {
		const config = parseBillingConfig(billingConfigJson);
		expect(config.currency).toBe('usd');
		expect(config.prices['server.small']).toEqual({ per: 'month', amount: 672, label: 'db3 Server (1 GB)' });
		expect(config.credits.ai.autoTopUp).toEqual({ below: 100, pack: 'ai-10' });
		expect(config.newAccountSpendLimit).toBe(5000);
	});

	it.each([
		[{ ...billingConfigJson, currency: 'USD' }, 'currency'],
		[{ ...billingConfigJson, graceDays: -1 }, 'graceDays'],
		[{ ...billingConfigJson, prices: { 'server.small': { per: 'hour', amount: 1, label: 'x' } } }, 'prices.server.small.per'],
		[{ ...billingConfigJson, prices: { 'server.small': { per: 'month', amount: 1.5, label: 'x' } } }, 'prices.server.small.amount'],
		[{ ...billingConfigJson, prices: { Server: { per: 'month', amount: 1, label: 'x' } } }, 'prices.Server'],
		[{ ...billingConfigJson, credits: { ai: { label: 'AI', packs: {}, autoTopUp: { below: 1, pack: 'nope' } } } }, 'credits.ai.autoTopUp.pack'],
		[{ ...billingConfigJson, credits: { ai: { label: 'AI', packs: { p: { amount: 100, credits: 0 } } } } }, 'credits.ai.packs.p.credits'],
	])('names the bad field', (input, path) => {
		expect(() => parseBillingConfig(input)).toThrow(BillingConfigError);
		try {
			parseBillingConfig(input);
		} catch (error) {
			expect((error as BillingConfigError).path).toBe(path);
		}
	});
});
