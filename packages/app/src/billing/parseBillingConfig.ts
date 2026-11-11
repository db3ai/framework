import type { BillingConfig, BillingCreditBucket, BillingPrice } from './contracts';

const PRICE_PER = ['month', 'day', 'use'] as const;
const KEY = /^[a-z0-9][a-z0-9._-]*$/;

/** Thrown when `db3/billing.json` is invalid; `path` names the bad field. */
export class BillingConfigError extends Error {
	constructor(readonly path: string, message: string) {
		super(`db3/billing.json ${path}: ${message}`);
		this.name = 'BillingConfigError';
	}
}

/**
 * Validates the parsed JSON of `db3/billing.json`.
 *
 * Amounts are whole minor units. Price and pack keys are lower-case slugs, so
 * they can be stored on usage rows and shown in provider metadata.
 */
export function parseBillingConfig(input: unknown): BillingConfig {
	const root = object(input, '');
	const currency = string(root.currency, 'currency');
	if (!/^[a-z]{3}$/.test(currency)) throw new BillingConfigError('currency', 'must be a lower-case ISO 4217 code');
	const prices: Record<string, BillingPrice> = {};
	for (const [key, value] of entries(root.prices, 'prices')) {
		const path = `prices.${key}`;
		const price = object(value, path);
		const per = string(price.per, `${path}.per`);
		if (!PRICE_PER.includes(per as BillingPrice['per'])) throw new BillingConfigError(`${path}.per`, `must be one of ${PRICE_PER.join(', ')}`);
		prices[key] = { per: per as BillingPrice['per'], amount: amount(price.amount, `${path}.amount`), label: string(price.label, `${path}.label`) };
	}
	const credits: Record<string, BillingCreditBucket> = {};
	for (const [key, value] of entries(root.credits ?? {}, 'credits')) {
		const path = `credits.${key}`;
		const bucket = object(value, path);
		const packs: Record<string, { amount: number; credits: number }> = {};
		for (const [packKey, packValue] of entries(bucket.packs, `${path}.packs`)) {
			const pack = object(packValue, `${path}.packs.${packKey}`);
			packs[packKey] = {
				amount: positive(pack.amount, `${path}.packs.${packKey}.amount`),
				credits: positive(pack.credits, `${path}.packs.${packKey}.credits`),
			};
		}
		let autoTopUp: BillingCreditBucket['autoTopUp'];
		if (bucket.autoTopUp !== undefined) {
			const top = object(bucket.autoTopUp, `${path}.autoTopUp`);
			const pack = string(top.pack, `${path}.autoTopUp.pack`);
			if (!packs[pack]) throw new BillingConfigError(`${path}.autoTopUp.pack`, `names no pack in ${path}.packs`);
			autoTopUp = { below: amount(top.below, `${path}.autoTopUp.below`), pack };
		}
		credits[key] = { label: string(bucket.label, `${path}.label`), packs, ...(autoTopUp ? { autoTopUp } : {}) };
	}
	return {
		currency,
		graceDays: amount(root.graceDays, 'graceDays'),
		newAccountSpendLimit: amount(root.newAccountSpendLimit, 'newAccountSpendLimit'),
		prices,
		credits,
	};
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BillingConfigError(path || '(root)', 'must be an object');
	return value as Record<string, unknown>;
}

function entries(value: unknown, path: string): [string, unknown][] {
	const result = Object.entries(object(value, path));
	for (const [key] of result) if (!KEY.test(key)) throw new BillingConfigError(`${path}.${key}`, 'key must be a lower-case slug');
	return result;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim() === '') throw new BillingConfigError(path, 'must be a non-empty string');
	return value;
}

function amount(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new BillingConfigError(path, 'must be a whole number of minor units, 0 or more');
	return value as number;
}

function positive(value: unknown, path: string): number {
	const result = amount(value, path);
	if (result === 0) throw new BillingConfigError(path, 'must be more than 0');
	return result;
}
