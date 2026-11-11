/**
 * How a price is charged.
 *
 * - `month`: a resource that runs for part or all of a month (a server). Billed by
 *   the started hour at `amount / 672`, capped at `amount` per resource per month.
 * - `day`: a switch-on add-on. Billed per UTC day it was on at any time.
 * - `use`: a counted action. Billed `quantity * amount`.
 */
export type BillingPricePer = 'month' | 'day' | 'use';

/** One price from `db3/billing.json`. Amounts are integer minor units (cents). */
export interface BillingPrice {
	readonly per: BillingPricePer;
	readonly amount: number;
	/** Line text on the invoice, for example `db3 Server (2 GB)`. */
	readonly label: string;
}

/** A prepaid credit pack bought with one card payment. */
export interface BillingCreditPack {
	/** Card charge in minor units. */
	readonly amount: number;
	/** Credits granted when the charge succeeds. */
	readonly credits: number;
}

/**
 * One prepaid credit bucket, for example `ai`. Running out stops only the work
 * that spends this bucket.
 */
export interface BillingCreditBucket {
	readonly label: string;
	readonly packs: Readonly<Record<string, BillingCreditPack>>;
	/** Default auto top-up: buy `pack` when the balance falls below `below` credits. */
	readonly autoTopUp?: { readonly below: number; readonly pack: string };
}

/**
 * Parsed `db3/billing.json`. Behaviour lives in this checked-in file; the
 * environment holds only provider secrets.
 */
export interface BillingConfig {
	/** ISO 4217 code in lower case, for example `usd`. */
	readonly currency: string;
	/** Days an account keeps running after a failed invoice before paid work stops. */
	readonly graceDays: number;
	/** Monthly spend limit in minor units until an account's first invoice is paid; per-account overrides live in the database. */
	readonly newAccountSpendLimit: number;
	readonly prices: Readonly<Record<string, BillingPrice>>;
	readonly credits: Readonly<Record<string, BillingCreditBucket>>;
}
