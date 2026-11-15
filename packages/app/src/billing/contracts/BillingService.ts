import type { BillingCard } from './BillingProvider';
import type { BillingInvoiceLine, BillingPeriod } from './BillingUsage';

/**
 * - `none`: no saved card yet.
 * - `active`: a card is saved and nothing is overdue.
 * - `past_due`: an invoice failed; paid work keeps running until the grace period ends.
 * - `suspended`: grace ended, or a dispute or fraud warning arrived; paid work stops.
 */
export type BillingAccountStatus = 'none' | 'active' | 'past_due' | 'suspended';

/** What an app shows about one billed owner, for example a Cloud organization. */
export interface BillingAccountSummary {
	readonly ownerId: string;
	readonly status: BillingAccountStatus;
	readonly card: Pick<BillingCard, 'brand' | 'last4' | 'expMonth' | 'expYear'> | null;
	/** Usage so far this month, in minor units, worked out the same way as the invoice. */
	readonly monthToDate: number;
	/** Monthly spend limit in minor units; null once the account has paid an invoice and has no override. */
	readonly spendLimit: number | null;
	/** When paid work stops if the overdue invoice is still unpaid. */
	readonly graceEndsAt: Date | null;
	readonly credits: Readonly<Record<string, number>>;
	/** Everything is free: charges are still made, with their lines, and paid at once without the provider. */
	readonly complimentary: boolean;
}

/** A charge as the owner sees it: a monthly invoice or a credit pack. Amounts are minor units. */
export interface BillingInvoiceSummary {
	readonly id: string;
	readonly kind: 'invoice' | 'credits';
	readonly state: 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';
	readonly amount: number;
	readonly currency: string;
	/** First day of the month an invoice covers; null for credit packs. */
	readonly periodStart: Date | null;
	readonly lines: readonly BillingInvoiceLine[];
	/** Credit packs: the bucket and credits granted. */
	readonly bucket: string | null;
	readonly credits: number | null;
	/** Where the owner pays or confirms a charge that is not paid yet. */
	readonly payUrl: string | null;
	/** Paid at $0 because the account is complimentary. */
	readonly complimentary: boolean;
	readonly paidAt: Date | null;
	readonly createdAt: Date;
}

/** Credits one source spent from one bucket. */
export interface BillingCreditUsage {
	readonly bucket: string;
	/** What the spend named, such as an app id (`studio`); null when it named none. */
	readonly source: string | null;
	readonly credits: number;
}

/** This month so far, worked out exactly as the invoice will be. */
export interface BillingInvoicePreview {
	readonly period: BillingPeriod;
	readonly lines: readonly BillingInvoiceLine[];
	readonly amount: number;
	readonly currency: string;
}

/** Answer to "may this owner start something that costs `monthly` more per month?". */
export interface BillingSpendCheck {
	readonly allowed: boolean;
	readonly reason?: 'no_card' | 'suspended' | 'spend_limit';
	/** Projected month total including running resources to month end, plus the new monthly amount. */
	readonly projected: number;
	readonly spendLimit: number | null;
}

/**
 * The app-facing billing API, `app().billing`. Owners are app ids (strings);
 * the app decides what an owner is. Usage calls are cheap database writes; the
 * provider is called only for cards, credit packs and the monthly invoice.
 */
export interface BillingService {
	summary(ownerId: string): Promise<BillingAccountSummary>;
	/** True when the account is complimentary, or a card is saved and the account is active or still in grace. */
	hasBilling(ownerId: string): Promise<boolean>;
	/**
	 * Resolves true as soon as `hasBilling(ownerId)` is true (a card.saved webhook
	 * in this process wakes it at once), or with the final answer after `timeoutMs`.
	 * Lets a CLI wait for card setup without polling.
	 */
	waitForBilling(ownerId: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<boolean>;
	cardSetupUrl(input: { ownerId: string; name: string; email: string; returnUrl: string }): Promise<string>;
	portalUrl(input: { ownerId: string; returnUrl: string }): Promise<string>;

	/**
	 * Makes an owner's account complimentary, or ends that. A complimentary account needs no card and has
	 * no spend limit; its invoices and credit packs are worked out and recorded as for anyone else, then
	 * paid at once without the provider, like a 100% coupon. Use it for the operator's own organizations.
	 */
	setComplimentary(input: { ownerId: string; complimentary: boolean }): Promise<void>;

	/** Before creating or resizing a resource: card, status and spend limit, counting `monthly` as a full month. */
	checkSpend(ownerId: string, monthly: number): Promise<BillingSpendCheck>;
	/** A resource starts on a `month` or `day` price. Starting it again on a new price ends the old span (resize). */
	startUsage(input: { ownerId: string; resourceId: string; price: string; at?: Date }): Promise<void>;
	/** A resource stops (server destroyed, add-on switched off). Does nothing if it is not running. */
	stopUsage(input: { ownerId: string; resourceId: string; at?: Date }): Promise<void>;
	/** One counted use of a `use` price. The same `key` is recorded once. */
	recordUse(input: { ownerId: string; key: string; price: string; quantity?: number; at?: Date }): Promise<void>;

	creditBalance(ownerId: string, bucket: string): Promise<number>;
	/**
	 * Spends credits for finished or reserved work. The same `key` spends once.
	 * Throws `BillingCreditsExhaustedError` when the balance is too low; when auto
	 * top-up is on, a top-up is started first and the error says so.
	 */
	spendCredits(input: { ownerId: string; bucket: string; amount: number; key: string; source?: string }): Promise<{ balance: number }>;
	/**
	 * Credits spent since a moment (default: the start of this month), per bucket and per
	 * `source` the spends named, most first. Spends without a source come back as `null`.
	 */
	creditUsage(ownerId: string, options?: { since?: Date }): Promise<BillingCreditUsage[]>;
	/** Charges the saved card for a pack; credits arrive when the charge is paid. */
	buyCredits(input: { ownerId: string; bucket: string; pack: string; ipAddress?: string }): Promise<{ status: 'paid' | 'pending' | 'failed'; payUrl?: string }>;
	setAutoTopUp(input: { ownerId: string; bucket: string; pack: string | null }): Promise<void>;
	/** Credit bucket to the pack bought automatically when it runs low. */
	autoTopUp(ownerId: string): Promise<Readonly<Record<string, string>>>;

	/** Charges one invoice per owner with usage in the period. Safe to run again. */
	/** This month's usage so far as invoice lines. */
	previewInvoice(ownerId: string): Promise<BillingInvoicePreview>;
	/** The owner's charges, newest first. */
	invoices(ownerId: string, options?: { limit?: number }): Promise<BillingInvoiceSummary[]>;
	invoicePeriod(period: BillingPeriod): Promise<{ invoiced: number; failed: number }>;
	/** Stores and applies one provider webhook. The same provider event applies once. */
	handleWebhook(rawBody: Buffer, signature: string): Promise<void>;
}
