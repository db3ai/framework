import Stripe from 'stripe';
import { BillingWebhookSignatureError, type BillingCard, type BillingChargeResult, type BillingInvoiceLine, type BillingProvider, type BillingProviderEvent, type BillingRiskContext } from '@db3.ai/app/billing';

/** The parts of the Stripe client this provider uses; a real `Stripe` instance satisfies it. */
export type StripeBillingClient = Pick<Stripe, 'customers' | 'checkout' | 'billingPortal' | 'invoices' | 'invoiceItems' | 'invoicePayments' | 'paymentMethods' | 'setupIntents' | 'charges' | 'webhooks'>;

export interface StripeBillingProviderOptions {
	/** Defaults to `STRIPE_SECRET_KEY`. */
	readonly secretKey?: string;
	/** Defaults to `STRIPE_WEBHOOK_SECRET`. */
	readonly webhookSecret?: string;
	/** Injected client for tests. */
	readonly client?: StripeBillingClient;
}

/** Creates the Stripe provider for `new App({ billing: { provider } })`. */
export function stripeBillingProvider(options: StripeBillingProviderOptions = {}): StripeBillingProvider {
	return new StripeBillingProvider(options);
}

/**
 * Stripe behind the billing port. Cards are saved with Checkout in setup mode
 * (3DS when the bank asks), every charge is a Stripe invoice paid off-session
 * from the default card, so customers get Stripe receipts and a hosted page
 * when a payment needs confirming.
 */
export class StripeBillingProvider implements BillingProvider {
	readonly #client: StripeBillingClient | undefined;
	readonly #secretKey: string | undefined;
	readonly #webhookSecret: string | undefined;

	constructor(options: StripeBillingProviderOptions = {}) {
		this.#client = options.client;
		this.#secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
		this.#webhookSecret = options.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
	}

	get #stripe(): StripeBillingClient {
		if (this.#client) return this.#client;
		if (!this.#secretKey) throw new Error('STRIPE_SECRET_KEY is not set.');
		return (this.#lazy ??= new Stripe(this.#secretKey));
	}

	#lazy: Stripe | undefined;

	async createCustomer(input: { accountId: string; name: string; email: string; idempotencyKey: string }) {
		const customer = await this.#stripe.customers.create(
			{ name: input.name, email: input.email, metadata: { db3_account_id: input.accountId } },
			{ idempotencyKey: input.idempotencyKey },
		);
		return { customerId: customer.id };
	}

	async cardSetupUrl(input: { customerId: string; returnUrl: string; idempotencyKey: string }) {
		const session = await this.#stripe.checkout.sessions.create({
			mode: 'setup',
			customer: input.customerId,
			payment_method_types: ['card'],
			success_url: input.returnUrl,
			cancel_url: input.returnUrl,
		}, { idempotencyKey: input.idempotencyKey });
		if (!session.url) throw new Error('Stripe returned no setup page.');
		return { url: session.url };
	}

	async portalUrl(input: { customerId: string; returnUrl: string }) {
		const session = await this.#stripe.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
		return { url: session.url };
	}

	async chargeInvoice(input: { customerId: string; currency: string; lines: readonly BillingInvoiceLine[]; description: string; idempotencyKey: string; risk: BillingRiskContext }) {
		return this.#invoice(input.customerId, input.currency, input.lines.map((line) => ({ amount: line.amount, description: lineText(line) })), input.description, input.idempotencyKey, input.risk);
	}

	async chargeOnce(input: { customerId: string; currency: string; amount: number; description: string; idempotencyKey: string; risk: BillingRiskContext }) {
		return this.#invoice(input.customerId, input.currency, [{ amount: input.amount, description: input.description }], input.description, input.idempotencyKey, input.risk);
	}

	async parseWebhook(rawBody: Buffer, signature: string): Promise<BillingProviderEvent> {
		if (!this.#webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
		let event: Stripe.Event;
		try {
			// Checking a signature needs only the webhook secret, not an API key.
			event = (this.#client?.webhooks ?? Stripe.webhooks).constructEvent(rawBody, signature, this.#webhookSecret);
		} catch (error) {
			throw new BillingWebhookSignatureError(error instanceof Error ? error.message : undefined);
		}
		const base = { eventId: event.id };
		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object;
				if (session.mode !== 'setup' || !session.setup_intent || !session.customer) break;
				const intent = await this.#stripe.setupIntents.retrieve(id(session.setup_intent));
				if (!intent.payment_method) break;
				const customerId = id(session.customer);
				const paymentMethod = id(intent.payment_method);
				await this.#stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethod } });
				return { ...base, customerId, type: 'card.saved', card: await this.#card(paymentMethod) };
			}
			case 'customer.updated': {
				const customer = event.data.object;
				const previous = event.data.previous_attributes as { invoice_settings?: unknown } | undefined;
				const method = customer.invoice_settings?.default_payment_method;
				if (!previous?.invoice_settings) break;
				if (!method) return { ...base, customerId: customer.id, type: 'card.removed' };
				return { ...base, customerId: customer.id, type: 'card.saved', card: await this.#card(id(method)) };
			}
			case 'invoice.paid': {
				const invoice = event.data.object;
				return { ...base, customerId: id(invoice.customer!), type: 'charge.paid', providerId: invoice.id!, amount: invoice.amount_paid };
			}
			case 'invoice.payment_failed': {
				const invoice = event.data.object;
				return { ...base, customerId: id(invoice.customer!), type: 'charge.failed', providerId: invoice.id!, reason: invoice.last_finalization_error?.message ?? 'payment failed' };
			}
			case 'charge.refunded': {
				const charge = event.data.object;
				const invoice = await this.#invoiceForCharge(charge);
				if (invoice) return { ...base, customerId: id(charge.customer!), type: 'charge.refunded', providerId: invoice, amount: charge.amount_refunded };
				break;
			}
			case 'charge.dispute.created': {
				const dispute = event.data.object;
				const charge = await this.#stripe.charges.retrieve(id(dispute.charge));
				const invoice = await this.#invoiceForCharge(charge);
				if (invoice) return { ...base, customerId: id(charge.customer!), type: 'charge.disputed', providerId: invoice, amount: dispute.amount };
				break;
			}
			case 'radar.early_fraud_warning.created': {
				const warning = event.data.object;
				const charge = await this.#stripe.charges.retrieve(id(warning.charge));
				const invoice = await this.#invoiceForCharge(charge);
				if (invoice) return { ...base, customerId: id(charge.customer!), type: 'charge.fraud_warning', providerId: invoice };
				break;
			}
		}
		return { ...base, customerId: '', type: 'ignored', providerType: event.type };
	}

	async #invoice(customerId: string, currency: string, items: { amount: number; description: string }[], description: string, key: string, risk: BillingRiskContext): Promise<BillingChargeResult> {
		const stripe = this.#stripe;
		const draft = await stripe.invoices.create({
			customer: customerId,
			currency,
			description,
			collection_method: 'charge_automatically',
			auto_advance: false,
			pending_invoice_items_behavior: 'exclude',
			metadata: {
				db3_account_id: risk.accountId,
				db3_account_created_at: risk.accountCreatedAt.toISOString(),
				...(risk.ipAddress ? { db3_ip_address: risk.ipAddress } : {}),
			},
		}, { idempotencyKey: `${key}:create` });
		for (const [index, item] of items.entries()) {
			await stripe.invoiceItems.create({ customer: customerId, invoice: draft.id!, currency, amount: item.amount, description: item.description }, { idempotencyKey: `${key}:item:${index}` });
		}
		const invoice = await stripe.invoices.finalizeInvoice(draft.id!, {}, { idempotencyKey: `${key}:finalize` });
		if (invoice.status === 'paid') return { providerId: invoice.id!, status: 'paid' };
		try {
			const paid = await stripe.invoices.pay(invoice.id!, { off_session: true }, { idempotencyKey: `${key}:pay` });
			return paid.status === 'paid' ? { providerId: paid.id!, status: 'paid' } : { providerId: paid.id!, status: 'pending', ...(paid.hosted_invoice_url ? { payUrl: paid.hosted_invoice_url } : {}) };
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code === 'invoice_payment_intent_requires_action') return { providerId: invoice.id!, status: 'pending', ...(invoice.hosted_invoice_url ? { payUrl: invoice.hosted_invoice_url } : {}) };
			if ((error as { type?: string }).type === 'StripeCardError') return { providerId: invoice.id!, status: 'failed', ...(invoice.hosted_invoice_url ? { payUrl: invoice.hosted_invoice_url } : {}) };
			throw error;
		}
	}

	async #card(paymentMethodId: string): Promise<BillingCard> {
		const method = await this.#stripe.paymentMethods.retrieve(paymentMethodId);
		const card = method.card;
		if (!card) throw new Error(`Stripe payment method ${paymentMethodId} is not a card.`);
		return { brand: card.brand, last4: card.last4, fingerprint: card.fingerprint ?? method.id, country: card.country ?? null, expMonth: card.exp_month, expYear: card.exp_year };
	}

	/** Every db3 charge is an invoice; find the invoice a card charge paid. */
	async #invoiceForCharge(charge: Stripe.Charge): Promise<string | null> {
		if (!charge.payment_intent) return null;
		const payments = await this.#stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: id(charge.payment_intent) }, limit: 1 });
		const invoice = payments.data[0]?.invoice;
		return invoice ? id(invoice) : null;
	}
}

function id(value: string | { id: string }): string {
	return typeof value === 'string' ? value : value.id;
}

function lineText(line: BillingInvoiceLine): string {
	return `${line.label} · ${line.quantity} ${line.unit}${line.quantity === 1 ? '' : 's'}`;
}
