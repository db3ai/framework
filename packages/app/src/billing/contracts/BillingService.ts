import type { BillingCard } from './BillingProvider';
import type { BillingPeriod } from './BillingUsage';

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
	/** Monthly spend limit in minor units. */
	readonly spendLimit: number;
	/** When paid work stops if the overdue invoice is still unpaid. */
	readonly graceEndsAt: Date | null;
	readonly credits: Readonly<Record<string, number>>;
}

/** Answer to "may this owner start something that costs `monthly` more per month?". */
export interface BillingSpendCheck {
	readonly allowed: boolean;
	readonly reason?: 'no_card' | 'suspended' | 'spend_limit';
	readonly monthToDate: number;
	readonly spendLimit: number;
}

/**
 * The app-facing billing API, `app().billing`. Owners are app ids (strings);
 * the app decides what an owner is. Usage calls are cheap database writes; the
 * provider is called only for cards, credit packs and the monthly invoice.
 */
export interface BillingService {
	summary(ownerId: string): Promise<BillingAccountSummary>;
	/** True when a card is saved and the account is active or still in grace. */
	hasBilling(ownerId: string): Promise<boolean>;
	cardSetupUrl(input: { ownerId: string; name: string; email: string; returnUrl: string }): Promise<string>;
	portalUrl(input: { ownerId: string; returnUrl: string }): Promise<string>;

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
	spendCredits(input: { ownerId: string; bucket: string; amount: number; key: string }): Promise<{ balance: number }>;
	/** Charges the saved card for a pack; credits arrive when the charge is paid. */
	buyCredits(input: { ownerId: string; bucket: string; pack: string; ipAddress?: string }): Promise<{ status: 'paid' | 'pending' | 'failed'; payUrl?: string }>;
	setAutoTopUp(input: { ownerId: string; bucket: string; pack: string | null }): Promise<void>;

	/** Charges one invoice per owner with usage in the period. Safe to run again. */
	invoicePeriod(period: BillingPeriod): Promise<{ invoiced: number; failed: number }>;
	/** Stores and applies one provider webhook. The same provider event applies once. */
	handleWebhook(rawBody: Buffer, signature: string): Promise<void>;
}
