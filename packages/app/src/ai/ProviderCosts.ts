import { AI_PROVIDER, type AIProvider } from './contracts/AI.js';

const USD_COST_PRECISION = 100_000_000;
const XAI_USD_TICKS_PER_DOLLAR = 10_000_000_000;

/** Provider response field used as the authoritative billed-cost source. */
export type ProviderReportedCostSource = 'openrouter_usage_cost' | 'xai_usage_cost_in_usd_ticks';

/** Authoritative billed cost reported for one provider request. */
export interface ProviderReportedCost {
	/** Provider response id used to deduplicate repeated terminal stream events. */
	responseId: string;
	/** Billed request cost in USD, rounded to the application's stored precision. */
	costUSD: number;
	/** Provider response field from which the cost was derived. */
	source: ProviderReportedCostSource;
}

/** Completeness summary for provider-reported costs across one agent attempt. */
export interface ProviderReportedCostSummary {
	/** Safely known subtotal across every captured provider response. */
	knownCostUSD: number;
	/** Complete attempt cost, or null when any expected response lacks billed cost. */
	costUSD: number | null;
	/** Number of unique provider responses with an authoritative billed cost. */
	reportedRequestCount: number;
	/** Number of provider requests reported by the Agents SDK. */
	expectedRequestCount: number;
	/** Provider fields that supplied the captured costs. */
	sources: ProviderReportedCostSource[];
}

/**
 * Extracts the authoritative billed USD cost from one provider payload.
 *
 * OpenRouter returns dollars in `usage.cost`. xAI returns integer USD ticks in
 * `usage.cost_in_usd_ticks`, where ten billion ticks equal one US dollar.
 * Other providers intentionally return null so locally estimated prices cannot
 * be mistaken for the amount actually charged by an intermediary.
 *
 * @param provider - Provider that returned the payload.
 * @param payload - Response object containing the provider usage block.
 * @returns Provider-reported billed cost in USD, or null when unavailable.
 */
export function providerReportedCostUSD(provider: AIProvider | string | null, payload: unknown): number | null {
	const usage = recordValue(recordValue(payload)?.usage);

	if (!usage) return null;

	if (provider === AI_PROVIDER.openrouter) {
		return validNonNegativeNumber(usage.cost);
	}

	if (provider === AI_PROVIDER.xai) {
		const ticks = validNonNegativeNumber(usage.cost_in_usd_ticks);

		return ticks === null ? null : roundCostUSD(ticks / XAI_USD_TICKS_PER_DOLLAR);
	}

	return null;
}

/**
 * Builds a deduplicatable cost entry for one terminal provider response.
 *
 * @param provider - Provider that returned the response.
 * @param payload - Response object containing provider usage.
 * @param responseId - Stable provider response identifier.
 * @returns Captured provider cost, or null when the id or billed cost is absent.
 */
export function providerReportedCost(
	provider: AIProvider | string | null,
	payload: unknown,
	responseId: unknown,
): ProviderReportedCost | null {
	if (typeof responseId !== 'string' || !responseId.trim()) return null;

	const costUSD = providerReportedCostUSD(provider, payload);

	if (costUSD === null) return null;

	return {
		responseId,
		costUSD,
		source: provider === AI_PROVIDER.xai
			? 'xai_usage_cost_in_usd_ticks'
			: 'openrouter_usage_cost',
	};
}

/**
 * Summarizes unique provider costs and fails closed when coverage is incomplete.
 *
 * @param costs - Cost entries keyed by provider response id.
 * @param expectedRequestCount - Provider request count reported by the SDK.
 * @returns Known subtotal plus an exact total only when every request is covered.
 */
export function summarizeProviderReportedCosts(
	costs: Map<string, ProviderReportedCost>,
	expectedRequestCount: number,
): ProviderReportedCostSummary {
	const entries = [...costs.values()];
	const knownCostUSD = roundCostUSD(entries.reduce((total, entry) => total + entry.costUSD, 0));
	const normalizedExpectedCount = Number.isFinite(expectedRequestCount) && expectedRequestCount >= 0
		? Math.trunc(expectedRequestCount)
		: 0;
	const complete = normalizedExpectedCount > 0 && entries.length === normalizedExpectedCount;

	return {
		knownCostUSD,
		costUSD: complete ? knownCostUSD : null,
		reportedRequestCount: entries.length,
		expectedRequestCount: normalizedExpectedCount,
		sources: [...new Set(entries.map(entry => entry.source))],
	};
}

/**
 * Converts a provider numeric field into a safe non-negative number.
 *
 * @param value - Unknown numeric value from a provider response.
 * @returns Rounded numeric value, or null when missing, negative, or invalid.
 */
function validNonNegativeNumber(value: unknown): number | null {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim()
			? Number(value)
			: null;

	if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return null;

	return roundCostUSD(parsed);
}

/**
 * Narrows an unknown value to a plain record.
 *
 * @param value - Unknown provider payload value.
 * @returns Record value, or null for scalars and arrays.
 */
function recordValue(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

	return value as Record<string, unknown>;
}

/**
 * Rounds provider billed cost to the precision stored on AiRequest.
 *
 * @param value - USD cost before persistence rounding.
 * @returns Cost rounded to eight decimal places.
 */
function roundCostUSD(value: number): number {
	return Math.round(value * USD_COST_PRECISION) / USD_COST_PRECISION;
}
