import type { BillingInvoiceLine } from './BillingUsage';

/** Card details the provider reports once a card is saved. Never the number. */
export interface BillingCard {
	readonly brand: string;
	readonly last4: string;
	/** Same value for the same card number across customers; used for one-trial-per-card and fraud checks. */
	readonly fingerprint: string;
	readonly country: string | null;
	readonly expMonth: number;
	readonly expYear: number;
}

/** Context sent with every payment so the provider's fraud rules can use it. */
export interface BillingRiskContext {
	readonly accountId: string;
	readonly accountCreatedAt: Date;
	readonly ipAddress?: string;
}

export type BillingChargeStatus = 'paid' | 'pending' | 'failed';

export interface BillingChargeResult {
	readonly providerId: string;
	readonly status: BillingChargeStatus;
	/** Page where the customer can pay or confirm (3DS) when not paid. */
	readonly payUrl?: string;
}

/**
 * Provider events the billing service acts on, already verified and mapped from
 * the provider's own event types. `eventId` is unique per provider event.
 */
export type BillingProviderEvent = { readonly eventId: string; readonly customerId: string } & (
	| { readonly type: 'card.saved'; readonly card: BillingCard }
	| { readonly type: 'card.removed' }
	| { readonly type: 'charge.paid'; readonly providerId: string; readonly amount: number }
	| { readonly type: 'charge.failed'; readonly providerId: string; readonly reason: string }
	| { readonly type: 'charge.refunded'; readonly providerId: string; readonly amount: number }
	| { readonly type: 'charge.disputed'; readonly providerId: string; readonly amount: number }
	| { readonly type: 'charge.fraud_warning'; readonly providerId: string }
	| { readonly type: 'ignored'; readonly providerType: string }
);

/**
 * The only code that talks to a payment provider. `@db3.ai/billing-stripe`
 * implements it; tests use a fake. Every write takes an idempotency key, and the
 * billing service never calls it inside a database transaction.
 */
export interface BillingProvider {
	createCustomer(input: { accountId: string; name: string; email: string; idempotencyKey: string }): Promise<{ customerId: string }>;
	/** Hosted page that saves a card with 3DS and no charge. */
	cardSetupUrl(input: { customerId: string; returnUrl: string; idempotencyKey: string }): Promise<{ url: string }>;
	/** Hosted page where the customer manages saved cards and sees invoices. */
	portalUrl(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
	/** Creates, finalizes and charges one invoice to the default saved card. */
	chargeInvoice(input: {
		customerId: string;
		currency: string;
		lines: readonly BillingInvoiceLine[];
		description: string;
		idempotencyKey: string;
		risk: BillingRiskContext;
	}): Promise<BillingChargeResult>;
	/** Charges the saved card once, for a credit pack or other one-time purchase. */
	chargeOnce(input: {
		customerId: string;
		currency: string;
		amount: number;
		description: string;
		idempotencyKey: string;
		risk: BillingRiskContext;
	}): Promise<BillingChargeResult>;
	/**
	 * Verifies the signature and maps the payload; throws `BillingWebhookSignatureError` on a bad signature. May
	 * read from the provider to resolve ids (a charge's invoice, a saved card).
	 */
	parseWebhook(rawBody: Buffer, signature: string): Promise<BillingProviderEvent>;
}
