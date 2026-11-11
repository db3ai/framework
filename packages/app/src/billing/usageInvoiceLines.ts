import type { BillingConfig, BillingInvoiceLine, BillingPeriod, BillingUsageSpan, BillingUse } from './contracts';

/** Hours in the monthly cap: 28 days, so a `month` price never charges more than its amount. */
export const BILLING_MONTH_HOURS = 672;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Works out a period's invoice lines from usage, at invoice time, with no meter.
 *
 * - `month` prices: seconds per resource and price inside the period, rounded up
 *   to whole hours, charged at `amount / 672` per hour and capped at `amount`.
 * - `day` prices: each UTC day a resource was on at any moment counts once.
 * - `use` prices: quantities summed per price, keyed uses counted once.
 *
 * Lines with zero amount are left out. Lines are sorted by price then resource.
 */
export function usageInvoiceLines(
	config: BillingConfig,
	period: BillingPeriod,
	spans: readonly BillingUsageSpan[],
	uses: readonly BillingUse[],
): BillingInvoiceLine[] {
	const start = period.start.getTime();
	const end = period.end.getTime();
	const lines: BillingInvoiceLine[] = [];
	const groups = new Map<string, { resourceId: string; price: string; ranges: [number, number][] }>();
	for (const span of spans) {
		const from = Math.max(start, span.startedAt.getTime());
		const to = Math.min(end, (span.endedAt ?? period.end).getTime());
		if (to <= from) continue;
		const key = `${span.price}\u0000${span.resourceId}`;
		const group = groups.get(key) ?? { resourceId: span.resourceId, price: span.price, ranges: [] };
		group.ranges.push([from, to]);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		const price = priceFor(config, group.price);
		const ranges = merge(group.ranges);
		if (price.per === 'month') {
			const ms = ranges.reduce((sum, [from, to]) => sum + to - from, 0);
			const hours = Math.min(BILLING_MONTH_HOURS, Math.ceil(ms / HOUR));
			const amount = hours === BILLING_MONTH_HOURS ? price.amount : Math.round((price.amount * hours) / BILLING_MONTH_HOURS);
			lines.push({ price: group.price, label: price.label, resourceId: group.resourceId, quantity: hours, unit: 'hour', amount });
		} else if (price.per === 'day') {
			const days = new Set<number>();
			for (const [from, to] of ranges) for (let day = Math.floor(from / DAY); day * DAY < to; day++) days.add(day);
			lines.push({ price: group.price, label: price.label, resourceId: group.resourceId, quantity: days.size, unit: 'day', amount: days.size * price.amount });
		} else {
			throw new Error(`Billing price ${group.price} is per use; report it with recordUse, not as a span.`);
		}
	}
	const useTotals = new Map<string, number>();
	const seen = new Set<string>();
	for (const use of uses) {
		const at = use.at.getTime();
		if (at < start || at >= end || seen.has(use.key)) continue;
		seen.add(use.key);
		if (priceFor(config, use.price).per !== 'use') throw new Error(`Billing price ${use.price} is not per use.`);
		useTotals.set(use.price, (useTotals.get(use.price) ?? 0) + use.quantity);
	}
	for (const [key, quantity] of useTotals) {
		const price = priceFor(config, key);
		lines.push({ price: key, label: price.label, quantity, unit: 'use', amount: quantity * price.amount });
	}
	return lines
		.filter((line) => line.amount > 0)
		.sort((a, b) => a.price.localeCompare(b.price) || (a.resourceId ?? '').localeCompare(b.resourceId ?? ''));
}

function priceFor(config: BillingConfig, key: string) {
	const price = config.prices[key];
	if (!price) throw new Error(`Billing price ${key} is not in db3/billing.json.`);
	return price;
}

/** Overlapping spans of one resource on one price count once. */
function merge(ranges: [number, number][]): [number, number][] {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	const result: [number, number][] = [];
	for (const range of sorted) {
		const last = result.at(-1);
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else result.push([...range]);
	}
	return result;
}
