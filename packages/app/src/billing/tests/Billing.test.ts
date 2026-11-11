import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '@db3.ai/app';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { BillingCreditsExhaustedError, billingModels, parseBillingConfig, type BillingProviderEvent } from '@db3.ai/app/billing';
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

	it('tops up automatically when the balance falls below the threshold', async () => {
		await withCard('org_1');
		await application.billing.setAutoTopUp({ ownerId: 'org_1', bucket: 'ai', pack: 'ai-10' });
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
