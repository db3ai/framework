/**
 * A period during which one resource ran on one `month` or `day` price, for
 * example a server from create until resize. Resizing ends one span and starts
 * another on the new price. `endedAt` is null while it still runs.
 */
export interface BillingUsageSpan {
	readonly resourceId: string;
	readonly price: string;
	readonly startedAt: Date;
	readonly endedAt: Date | null;
}

/** A counted use of a `use` price. `key` makes repeated reports harmless. */
export interface BillingUse {
	readonly key: string;
	readonly price: string;
	readonly quantity: number;
	readonly at: Date;
}

/** A half-open billing period `[start, end)`, normally one UTC calendar month. */
export interface BillingPeriod {
	readonly start: Date;
	readonly end: Date;
}

/** One invoice line worked out from usage. Amount is in minor units. */
export interface BillingInvoiceLine {
	readonly price: string;
	readonly label: string;
	/** Resource the line is for; absent for `use` lines, which group by price. */
	readonly resourceId?: string;
	/** Hours for `month`, days for `day`, total quantity for `use`. */
	readonly quantity: number;
	readonly unit: 'hour' | 'day' | 'use';
	readonly amount: number;
}
