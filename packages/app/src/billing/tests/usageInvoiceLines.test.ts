import { describe, expect, it } from 'vitest';
import { parseBillingConfig, usageInvoiceLines } from '../index';
import { billingConfigJson } from './support/billingConfigJson';

const config = parseBillingConfig(billingConfigJson);
const november = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') };
const at = (iso: string) => new Date(`2026-11-${iso}Z`);

describe('usageInvoiceLines', () => {
	it('bills a server by the started hour', () => {
		const lines = usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.small', startedAt: at('10T09:15:00'), endedAt: at('10T12:16:00') },
		], []);
		expect(lines).toEqual([{ price: 'server.small', label: 'db3 Server (1 GB)', resourceId: 'srv_1', quantity: 4, unit: 'hour', amount: 4 }]);
	});

	it('caps a server that runs all month at its monthly price', () => {
		const lines = usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.medium', startedAt: new Date('2026-10-20T00:00:00Z'), endedAt: null },
		], []);
		expect(lines).toMatchObject([{ quantity: 672, amount: 2400 }]);
	});

	it('splits a resize into two lines, one per size', () => {
		const lines = usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.small', startedAt: at('01T00:00:00'), endedAt: at('11T00:00:00') },
			{ resourceId: 'srv_1', price: 'server.medium', startedAt: at('11T00:00:00'), endedAt: null },
		], []);
		expect(lines).toMatchObject([
			{ price: 'server.medium', quantity: 480, amount: Math.round((2400 * 480) / 672) },
			{ price: 'server.small', quantity: 240, amount: 240 },
		]);
	});

	it('counts overlapping spans of one resource once', () => {
		const lines = usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.small', startedAt: at('01T00:00:00'), endedAt: at('01T02:00:00') },
			{ resourceId: 'srv_1', price: 'server.small', startedAt: at('01T01:00:00'), endedAt: at('01T03:00:00') },
		], []);
		expect(lines).toMatchObject([{ quantity: 3 }]);
	});

	it('bills a switch-on add-on per UTC day it was on', () => {
		const lines = usageInvoiceLines(config, november, [
			{ resourceId: 'app_1', price: 'addon.security-monitor', startedAt: at('03T23:30:00'), endedAt: at('05T00:30:00') },
		], []);
		expect(lines).toMatchObject([{ resourceId: 'app_1', quantity: 3, unit: 'day', amount: 30 }]);
	});

	it('sums counted uses per price and counts a repeated key once', () => {
		const lines = usageInvoiceLines(config, november, [], [
			{ key: 'a', price: 'domain.check', quantity: 3, at: at('02T00:00:00') },
			{ key: 'a', price: 'domain.check', quantity: 3, at: at('02T00:00:00') },
			{ key: 'b', price: 'domain.check', quantity: 1, at: at('03T00:00:00') },
			{ key: 'c', price: 'domain.check', quantity: 9, at: new Date('2026-12-01T00:00:00Z') },
		]);
		expect(lines).toEqual([{ price: 'domain.check', label: 'Domain check', quantity: 4, unit: 'use', amount: 8 }]);
	});

	it('leaves out spans outside the period and prices not in the config fail loudly', () => {
		expect(usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.small', startedAt: new Date('2026-10-01T00:00:00Z'), endedAt: new Date('2026-10-02T00:00:00Z') },
		], [])).toEqual([]);
		expect(() => usageInvoiceLines(config, november, [
			{ resourceId: 'srv_1', price: 'server.huge', startedAt: at('01T00:00:00'), endedAt: null },
		], [])).toThrow(/not in db3\/billing.json/);
	});
});
