import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@db3.ai/app';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { BillingCharge, BillingCreditsExhaustedError, billingModels, parseBillingConfig, type BillingProviderEvent } from '@db3.ai/app/billing';
import { billingConfigJson } from './support/billingConfigJson';
import { FakeBillingProvider } from './support/FakeBillingProvider';

let database: GeneratedTestDatabase;
let application: App;
let provider: FakeBillingProvider;
let now: Date;
let events = 0;

const card = { brand: 'visa', last4: '4242', fingerprint: 'fp_1', country: 'GB', expMonth: 12, expYear: 2030 };
const webhook = (event: Omit<BillingProviderEvent, 'eventId'> & { eventId?: string }) =>
	application.billing.handleWebhook(Buffer.from(JSON.stringify({ eventId: `evt_${++events}`, ...event })), 'ok');

/** Saves a card for `ownerId` through the same path as the hosted setup page. */
async function withCard(ownerId: string) {
	await application.billing.cardSetupUrl({ ownerId, name: 'Org', email: 'o@example.test', returnUrl: 'https://cloud.test/billing' });
	const customerId = provider.calls.filter((call) => call.method === 'createCustomer').at(-1)!.input.accountId;
	await webhook({ type: 'card.saved', customerId: `cus_${customerId}`, card });
	return `cus_${customerId}`;
}

beforeEach(async () => {
	database = await createGeneratedTestDatabase('billing');
	provider = new FakeBillingProvider();
	now = new Date('2026-11-10T12:00:00Z');
	application = new App({ db: database.db, billing: { provider, config: parseBillingConfig(billingConfigJson), now: () => now } });
	await application.db.install(...billingModels);
});

afterEach(async () => {
	try { if (application) await application.close(); } finally { if (database) await database.destroy(); }
});

describe('billing accounts and cards', () => {
	it('has billing only once a card is saved, and applies each provider event once', async () => {
		expect(await application.billing.hasBilling('org_1')).toBe(false);
		const url = await application.billing.cardSetupUrl({ ownerId: 'org_1', name: 'Org', email: 'o@example.test', returnUrl: 'https://cloud.test' });
		expect(url).toMatch(/^https:\/\/pay\.test\/setup\/cus_/);
		const customerId = url.split('/').at(-1)!;
		const event = Buffer.from(JSON.stringify({ eventId: 'evt_card', type: 'card.saved', customerId, card }));
		await application.billing.handleWebhook(event, 'ok');
		await application.billing.handleWebhook(event, 'ok');
		expect(await application.billing.hasBilling('org_1')).toBe(true);
		expect((await application.billing.summary('org_1')).card).toEqual({ brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
		await application.billing.cardSetupUrl({ ownerId: 'org_1', name: 'Org', email: 'o@example.test', returnUrl: 'https://cloud.test' });
		expect(provider.calls.filter((call) => call.method === 'createCustomer')).toHaveLength(1);
		await expect(application.billing.handleWebhook(event, 'forged')).rejects.toThrow('bad signature');
	});
});

describe('waiting for card setup', () => {
	it('wakes as soon as the card is saved, and times out with false', async () => {
		expect(await application.billing.waitForBilling('org_2', { timeoutMs: 20 })).toBe(false);
		const waiting = application.billing.waitForBilling('org_1', { timeoutMs: 10_000 });
		const started = Date.now();
		await withCard('org_1');
		expect(await waiting).toBe(true);
		expect(Date.now() - started).toBeLessThan(5_000);
	});
});

describe('spend limit', () => {
	it('needs a card, and holds a new account to the new-account limit for the projected month', async () => {
		expect(await application.billing.checkSpend('org_1', 2400)).toMatchObject({ allowed: false, reason: 'no_card' });
		await withCard('org_1');
		expect(await application.billing.checkSpend('org_1', 2400)).toMatchObject({ allowed: true, spendLimit: 5000 });
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.medium' });
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_2', price: 'server.medium' });
		const check = await application.billing.checkSpend('org_1', 2400);
		expect(check).toMatchObject({ allowed: false, reason: 'spend_limit' });
		expect(check.projected).toBeGreaterThan(5000);
	});
});

describe('usage and the monthly invoice', () => {
	it('bills a resized server by the hour on one invoice, once', async () => {
		await withCard('org_1');
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-11-01T00:00:00Z') });
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.medium', at: new Date('2026-11-11T00:00:00Z') });
		await application.billing.stopUsage({ ownerId: 'org_1', resourceId: 'srv_1', at: new Date('2026-11-12T00:00:00Z') });
		await application.billing.recordUse({ ownerId: 'org_1', key: 'check-1', price: 'domain.check' });
		await application.billing.recordUse({ ownerId: 'org_1', key: 'check-1', price: 'domain.check' });
		const november = { start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') };
		expect(await application.billing.invoicePeriod(november)).toEqual({ invoiced: 1, failed: 0 });
		expect(await application.billing.invoicePeriod(november)).toEqual({ invoiced: 0, failed: 0 });
		const invoices = provider.calls.filter((call) => call.method === 'chargeInvoice');
		expect(invoices).toHaveLength(1);
		expect(invoices[0]!.input.lines).toMatchObject([
			{ price: 'domain.check', quantity: 1, amount: 2 },
			{ price: 'server.medium', quantity: 24, amount: Math.round((2400 * 24) / 672) },
			{ price: 'server.small', quantity: 240, amount: 240 },
		]);
		expect(invoices[0]!.input.idempotencyKey).toMatch(/^invoice:.+:2026-11$/);
		expect((await application.billing.summary('org_1')).spendLimit).toBeNull();
	});

	it('keeps paid work running through the grace period after a failed invoice, then suspends', async () => {
		const customerId = await withCard('org_1');
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-10-01T00:00:00Z') });
		provider.nextStatus = 'failed';
		const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') };
		expect(await application.billing.invoicePeriod(october)).toEqual({ invoiced: 0, failed: 1 });
		expect((await application.billing.summary('org_1')).status).toBe('past_due');
		expect(await application.billing.hasBilling('org_1')).toBe(true);
		now = new Date('2026-11-14T00:00:00Z');
		expect((await application.billing.summary('org_1')).status).toBe('suspended');
		expect(await application.billing.hasBilling('org_1')).toBe(false);
		await webhook({ type: 'charge.paid', customerId, providerId: 'in_1', amount: 672 });
		expect((await application.billing.summary('org_1')).status).toBe('active');
	});
});

describe('complimentary accounts', () => {
	it('needs no card or spend limit, and records invoices and credit packs as paid without the provider', async () => {
		await application.billing.setComplimentary({ ownerId: 'org_1', complimentary: true });
		expect(await application.billing.hasBilling('org_1')).toBe(true);
		expect(await application.billing.checkSpend('org_1', 1_000_000)).toMatchObject({ allowed: true, spendLimit: null });
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-10-01T00:00:00Z') });
		const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') };
		expect(await application.billing.invoicePeriod(october)).toEqual({ invoiced: 1, failed: 0 });
		expect(await application.billing.invoicePeriod(october)).toEqual({ invoiced: 0, failed: 0 });
		const invoice = await BillingCharge.where('kind', 'invoice').firstOrFail();
		expect(invoice).toMatchObject({ state: 'paid', amount: 672 });
		expect(invoice.providerId).toMatch(/^complimentary:/);
		expect(invoice.lines).toMatchObject([{ price: 'server.small', resourceId: 'srv_1', amount: 672 }]);
		expect(await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' })).toEqual({ status: 'paid' });
		expect(await application.billing.creditBalance('org_1', 'ai')).toBe(1000);
		expect(provider.calls).toEqual([]);
		expect((await application.billing.summary('org_1')).complimentary).toBe(true);

		await application.billing.setComplimentary({ ownerId: 'org_1', complimentary: false });
		expect(await application.billing.checkSpend('org_1', 672)).toMatchObject({ allowed: false, reason: 'no_card' });
	});

	it('leaves an invoice already sent to the provider tracked there when the account turns complimentary', async () => {
		await withCard('org_1');
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-10-01T00:00:00Z') });
		const october = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-11-01T00:00:00Z') };
		provider.nextStatus = 'pending';
		await application.billing.invoicePeriod(october);
		const sent = (await BillingCharge.where('kind', 'invoice').firstOrFail()).providerId;
		await application.billing.setComplimentary({ ownerId: 'org_1', complimentary: true });
		provider.nextStatus = 'paid';
		await application.billing.invoicePeriod(october);
		expect(await BillingCharge.where('kind', 'invoice').firstOrFail()).toMatchObject({ providerId: sent, state: 'paid' });
	});
});

describe('invoice preview and history', () => {
	it('counts the platform fee the first resource of a month brings in against the spend limit', async () => {
		application = new App({ db: database.db, billing: { provider, config: parseBillingConfig({ ...billingConfigJson, platformFee: { amount: 500, label: 'Platform fee' } }), now: () => now } });
		await withCard('org_1');
		expect(await application.billing.checkSpend('org_1', 4800)).toMatchObject({ allowed: false, reason: 'spend_limit', projected: 5300 });
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-11-01T00:00:00Z') });
		expect((await application.billing.checkSpend('org_1', 100)).projected).toBe(672 + 500 + 100);
	});

	it('shows this month so far, then the charged invoice in the history', async () => {
		await withCard('org_1');
		await application.billing.startUsage({ ownerId: 'org_1', resourceId: 'srv_1', price: 'server.small', at: new Date('2026-11-01T00:00:00Z') });
		const preview = await application.billing.previewInvoice('org_1');
		expect(preview).toMatchObject({ currency: 'usd', amount: 228, lines: [{ price: 'server.small', quantity: 228, unit: 'hour' }] });
		expect(await application.billing.invoices('org_1')).toEqual([]);
		now = new Date('2026-12-01T00:00:00Z');
		await application.billing.invoicePeriod({ start: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-12-01T00:00:00Z') });
		const [invoice] = await application.billing.invoices('org_1');
		expect(invoice).toMatchObject({ kind: 'invoice', state: 'paid', amount: 672, complimentary: false, payUrl: null, lines: [{ price: 'server.small', quantity: 672 }] });
		expect(await application.billing.invoices('org_2')).toEqual([]);
	});
});

describe('prepaid credits', () => {
	it('grants a paid pack, spends once per key and refuses when empty', async () => {
		await withCard('org_1');
		expect(await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' })).toEqual({ status: 'paid' });
		expect(await application.billing.creditBalance('org_1', 'ai')).toBe(1000);
		expect(await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 600, key: 'run-1' })).toEqual({ balance: 400 });
		expect(await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 600, key: 'run-1' })).toEqual({ balance: 400 });
		const error = await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 600, key: 'run-2' }).catch((caught) => caught);
		expect(error).toBeInstanceOf(BillingCreditsExhaustedError);
		expect(error).toMatchObject({ balance: 400, topUpStarted: false });
	});

	it('totals this month\'s spends by the app that made them', async () => {
		await withCard('org_1');
		await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' });
		await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 300, key: 'studio-1', source: 'studio' });
		await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 200, key: 'studio-2', source: 'studio' });
		await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 100, key: 'tests-1', source: 'test_engineer' });
		await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 50, key: 'other-1' });
		expect(await application.billing.creditUsage('org_1')).toEqual([
			{ bucket: 'ai', source: 'studio', credits: 500 },
			{ bucket: 'ai', source: 'test_engineer', credits: 100 },
			{ bucket: 'ai', source: null, credits: 50 },
		]);
		expect(await application.billing.creditUsage('org_1', { since: new Date(Date.now() + 60_000) })).toEqual([]);
		expect(await application.billing.creditUsage('org_2')).toEqual([]);
	});

	it('prices work by its cost plus the markup, and records finished work past zero', async () => {
		expect(application.billing.creditsForCost('ai', 0)).toBe(0);
		expect(application.billing.creditsForCost('ai', 0.01)).toBe(1);
		expect(application.billing.creditsForCost('ai', 250)).toBe(300);
		expect(application.billing.creditsForCost('ai', 2.5)).toBe(3);
		await withCard('org_1');
		await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' });
		await expect(application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 1500, key: 'big-run' })).rejects.toBeInstanceOf(BillingCreditsExhaustedError);
		expect(await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 1500, key: 'big-run', overdraw: true })).toEqual({ balance: -500 });
		expect(await application.billing.creditBalance('org_1', 'ai')).toBe(-500);
	});

	it('tops up automatically when the balance falls below the threshold', async () => {
		await withCard('org_1');
		await application.billing.setAutoTopUp({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' });
		expect(await application.billing.autoTopUp('org_1')).toEqual({ ai: 'ai-10' });
		await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' });
		await application.billing.spendCredits({ ownerId: 'org_1', bucket: 'ai', amount: 950, key: 'run-1' });
		expect(await application.billing.creditBalance('org_1', 'ai')).toBe(1050);
		expect(provider.calls.filter((call) => call.method === 'chargeOnce')).toHaveLength(2);
	});

	it('takes credits back on a dispute and suspends the account', async () => {
		const customerId = await withCard('org_1');
		await application.billing.buyCredits({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-50' });
		const providerId = 'pi_1';
		await webhook({ type: 'charge.disputed', customerId, providerId, amount: 5000 });
		await webhook({ type: 'charge.disputed', customerId, providerId, amount: 5000 });
		expect(await application.billing.creditBalance('org_1', 'ai')).toBe(0);
		expect(await application.billing.hasBilling('org_1')).toBe(false);
		expect((await application.billing.checkSpend('org_1', 0)).reason).toBe('suspended');
	});
});
