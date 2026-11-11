import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { stripeBillingProvider, type StripeBillingClient } from '../index';

const secret = 'whsec_test';
const real = new Stripe('sk_test_unused');
const risk = { accountId: 'acc_1', accountCreatedAt: new Date('2026-11-01T00:00:00Z') };

/** Fake Stripe resources recording calls; webhooks use the real signature code. */
function fakeStripe(overrides: { pay?: () => Promise<any> } = {}) {
	const calls: [string, any, any?][] = [];
	const record = (name: string, result: () => any) => async (...args: any[]) => { calls.push([name, ...args] as [string, any, any?]); return result(); };
	const client = {
		customers: { create: record('customers.create', () => ({ id: 'cus_1' })), update: record('customers.update', () => ({})) },
		checkout: { sessions: { create: record('checkout.sessions.create', () => ({ url: 'https://checkout.stripe.test/s' })) } },
		billingPortal: { sessions: { create: record('billingPortal.sessions.create', () => ({ url: 'https://billing.stripe.test/p' })) } },
		invoices: {
			create: record('invoices.create', () => ({ id: 'in_1' })),
			finalizeInvoice: record('invoices.finalizeInvoice', () => ({ id: 'in_1', status: 'open', hosted_invoice_url: 'https://invoice.stripe.test/in_1' })),
			pay: overrides.pay ?? record('invoices.pay', () => ({ id: 'in_1', status: 'paid' })),
		},
		invoiceItems: { create: record('invoiceItems.create', () => ({})) },
		invoicePayments: { list: record('invoicePayments.list', () => ({ data: [{ invoice: 'in_1' }] })) },
		paymentMethods: { retrieve: record('paymentMethods.retrieve', () => ({ id: 'pm_1', card: { brand: 'visa', last4: '4242', fingerprint: 'fp', country: 'GB', exp_month: 1, exp_year: 2031 } })) },
		setupIntents: { retrieve: record('setupIntents.retrieve', () => ({ payment_method: 'pm_1' })) },
		charges: { retrieve: record('charges.retrieve', () => ({ id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1' })) },
		webhooks: real.webhooks,
	} as unknown as StripeBillingClient;
	return { client, calls };
}

function signed(event: object) {
	const payload = JSON.stringify(event);
	return [Buffer.from(payload), real.webhooks.generateTestHeaderString({ payload, secret })] as const;
}

describe('stripeBillingProvider', () => {
	it('charges usage as one invoice with a line per usage line, keyed for retries', async () => {
		const { client, calls } = fakeStripe();
		const provider = stripeBillingProvider({ client, webhookSecret: secret });
		const result = await provider.chargeInvoice({
			customerId: 'cus_1', currency: 'usd', description: 'Usage for 2026-11', idempotencyKey: 'invoice:acc_1:2026-11', risk,
			lines: [{ price: 'server.small', label: 'db3 Server (1 GB)', resourceId: 'srv_1', quantity: 240, unit: 'hour', amount: 240 }],
		});
		expect(result).toEqual({ providerId: 'in_1', status: 'paid' });
		expect(calls.map(([name]) => name)).toEqual(['invoices.create', 'invoiceItems.create', 'invoices.finalizeInvoice', 'invoices.pay']);
		expect(calls[1]![1]).toMatchObject({ invoice: 'in_1', amount: 240, description: 'db3 Server (1 GB) · 240 hours' });
		expect(calls[1]![2]).toEqual({ idempotencyKey: 'invoice:acc_1:2026-11:item:0' });
		expect(calls[0]![1].metadata).toMatchObject({ db3_account_id: 'acc_1' });
	});

	it('reports a declined card as failed and a 3DS request as pending with the invoice page', async () => {
		const declined = stripeBillingProvider({ client: fakeStripe({ pay: async () => { throw Object.assign(new Error('declined'), { type: 'StripeCardError' }); } }).client, webhookSecret: secret });
		expect(await declined.chargeOnce({ customerId: 'cus_1', currency: 'usd', amount: 1000, description: 'AI credits', idempotencyKey: 'credits:1', risk }))
			.toMatchObject({ providerId: 'in_1', status: 'failed' });
		const action = stripeBillingProvider({ client: fakeStripe({ pay: async () => { throw Object.assign(new Error('auth'), { code: 'invoice_payment_intent_requires_action' }); } }).client, webhookSecret: secret });
		expect(await action.chargeOnce({ customerId: 'cus_1', currency: 'usd', amount: 1000, description: 'AI credits', idempotencyKey: 'credits:2', risk }))
			.toEqual({ providerId: 'in_1', status: 'pending', payUrl: 'https://invoice.stripe.test/in_1' });
	});

	it('maps a completed card setup to card.saved and makes it the default card', async () => {
		const { client, calls } = fakeStripe();
		const provider = stripeBillingProvider({ client, webhookSecret: secret });
		const event = await provider.parseWebhook(...signed({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { mode: 'setup', setup_intent: 'seti_1', customer: 'cus_1' } } }));
		expect(event).toEqual({ eventId: 'evt_1', customerId: 'cus_1', type: 'card.saved', card: { brand: 'visa', last4: '4242', fingerprint: 'fp', country: 'GB', expMonth: 1, expYear: 2031 } });
		expect(calls.find(([name]) => name === 'customers.update')).toEqual(['customers.update', 'cus_1', { invoice_settings: { default_payment_method: 'pm_1' } }]);
	});

	it('maps disputes and fraud warnings to the invoice the charge paid', async () => {
		const provider = stripeBillingProvider({ client: fakeStripe().client, webhookSecret: secret });
		expect(await provider.parseWebhook(...signed({ id: 'evt_2', type: 'charge.dispute.created', data: { object: { charge: 'ch_1', amount: 1000 } } })))
			.toEqual({ eventId: 'evt_2', customerId: 'cus_1', type: 'charge.disputed', providerId: 'in_1', amount: 1000 });
		expect(await provider.parseWebhook(...signed({ id: 'evt_3', type: 'radar.early_fraud_warning.created', data: { object: { charge: 'ch_1' } } })))
			.toEqual({ eventId: 'evt_3', customerId: 'cus_1', type: 'charge.fraud_warning', providerId: 'in_1' });
		expect(await provider.parseWebhook(...signed({ id: 'evt_4', type: 'invoice.paid', data: { object: { id: 'in_1', customer: 'cus_1', amount_paid: 240 } } })))
			.toEqual({ eventId: 'evt_4', customerId: 'cus_1', type: 'charge.paid', providerId: 'in_1', amount: 240 });
		expect((await provider.parseWebhook(...signed({ id: 'evt_5', type: 'customer.created', data: { object: {} } }))).type).toBe('ignored');
	});

	it('rejects a bad signature', async () => {
		const provider = stripeBillingProvider({ client: fakeStripe().client, webhookSecret: secret });
		const [body] = signed({ id: 'evt_6', type: 'invoice.paid', data: { object: {} } });
		await expect(provider.parseWebhook(body, 't=1,v1=bad')).rejects.toThrow();
	});
});
