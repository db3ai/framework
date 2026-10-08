import type { AIModelPricing, AIImageModelPricing, AIRequestCostUsage, AIRequestCostUsageEntry, AIImageRequestCostUsage, AIHostedToolUsage, AIHostedToolCost } from './contracts/Pricing';
export type { AIModelPricing, AIImageModelPricing, AIRequestCostUsage, AIRequestCostUsageEntry, AIImageRequestCostUsage, AIHostedToolUsage, AIHostedToolCost } from './contracts/Pricing';

/**
 * OpenAI Standard processing prices in USD, verified on 2026-09-25.
 *
 * Used to estimate request cost at write time; stored historical costs are not
 * recalculated. Excludes regional processing surcharges. Tier multipliers were verified on 2026-10-08.
 *
 * @see https://developers.openai.com/api/docs/pricing
 */
export const AI_MODEL_PRICING: Record<string, AIModelPricing> = {
	// Default lightweight agent model; Standard rates verified on 2026-10-01.
	'gpt-4.1-mini': {
		inputUSDPer1M: 0.40,
		cachedInputUSDPer1M: 0.10,
		outputUSDPer1M: 1.60,
	},
	'gpt-6-astra': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 10.00,
		cachedInputUSDPer1M: 1.00,
		outputUSDPer1M: 50.00,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-6-sol': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 2.00,
		cachedInputUSDPer1M: 0.20,
		outputUSDPer1M: 10.00,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-6-luna': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 0.10,
		cachedInputUSDPer1M: 0.01,
		outputUSDPer1M: 0.50,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	// Promotional rates available at least through 2026-11-21; recheck before changing.
	'gpt-5.6-sol': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 4.00,
		cachedInputUSDPer1M: 0.40,
		outputUSDPer1M: 20.00,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.6-terra': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 2.00,
		cachedInputUSDPer1M: 0.20,
		outputUSDPer1M: 12.00,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.6-luna': {
		serviceTierMultipliers: { flex: 0.5, fast: 2, priority: 2 },
		inputUSDPer1M: 0.20,
		cachedInputUSDPer1M: 0.02,
		outputUSDPer1M: 1.20,
		cacheWriteInputMultiplier: 1.25,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.5': {
		inputUSDPer1M: 5.00,
		cachedInputUSDPer1M: 0.50,
		outputUSDPer1M: 30.00,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.5-pro': {
		inputUSDPer1M: 30.00,
		cachedInputUSDPer1M: null,
		outputUSDPer1M: 180.00,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.4': {
		inputUSDPer1M: 2.50,
		cachedInputUSDPer1M: 0.25,
		outputUSDPer1M: 15.00,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'gpt-5.4-mini': {
		inputUSDPer1M: 0.75,
		cachedInputUSDPer1M: 0.075,
		outputUSDPer1M: 4.50,
	},
	'gpt-5.4-nano': {
		inputUSDPer1M: 0.20,
		cachedInputUSDPer1M: 0.02,
		outputUSDPer1M: 1.25,
	},
	'gpt-5.4-pro': {
		inputUSDPer1M: 30.00,
		cachedInputUSDPer1M: null,
		outputUSDPer1M: 180.00,
		longContextInputTokenThreshold: 272_000,
		longContextInputMultiplier: 2,
		longContextOutputMultiplier: 1.5,
	},
	'text-embedding-3-small': {
		inputUSDPer1M: 0.02,
		cachedInputUSDPer1M: null,
		outputUSDPer1M: null,
	},
	'text-embedding-3-large': {
		inputUSDPer1M: 0.13,
		cachedInputUSDPer1M: null,
		outputUSDPer1M: null,
	},
	'text-embedding-ada-002': {
		inputUSDPer1M: 0.10,
		cachedInputUSDPer1M: null,
		outputUSDPer1M: null,
	},
};

/**
 * OpenAI Standard image token prices in USD, verified on 2026-09-11.
 *
 * Flare and GPT Image 2 share token rates, but may consume different token
 * counts for the same size and quality. Estimate costs from reported usage.
 *
 * @see https://developers.openai.com/api/docs/pricing
 */
export const AI_IMAGE_MODEL_PRICING: Record<string, AIImageModelPricing> = {
	'gpt-image-2.5-flare': {
		textInputUSDPer1M: 5.00,
		cachedTextInputUSDPer1M: 1.25,
		imageInputUSDPer1M: 8.00,
		cachedImageInputUSDPer1M: 2.00,
		imageOutputUSDPer1M: 30.00,
	},
	'gpt-image-2': {
		textInputUSDPer1M: 5.00,
		cachedTextInputUSDPer1M: 1.25,
		imageInputUSDPer1M: 8.00,
		cachedImageInputUSDPer1M: 2.00,
		imageOutputUSDPer1M: 30.00,
	},
};

/**
 * Hardcoded per-call pricing for hosted provider tools that do not create their
 * own AI request row.
 */
export const AI_HOSTED_TOOL_PRICING_USD: Record<string, number> = {
	web_search_call: 0.01,
};

const TOKENS_PER_PRICING_UNIT = 1_000_000;
const COST_PRECISION = 100_000_000;

/**
 * Calculates an estimated USD cost from normalized usage and model pricing.
 *
 * Unknown models and incomplete paid token dimensions return null so callers do
 * not persist misleading costs. Input-only models can omit output tokens.
 *
 * @param model - Provider model used by the request.
 * @param usage - Normalized token counts from the provider response.
 * @returns Rounded USD cost, or null when cost cannot be computed.
 */
export function calculateAIRequestCostUSD(
	model: string,
	usage: AIRequestCostUsage,
): number | null {
	const pricing = AI_MODEL_PRICING[canonicalModelName(model)];

	if (!pricing) return null;
	const tier = usage.serviceTier === undefined ? 'default' : usage.serviceTier;
	const tierMultiplier = tier === 'default' ? 1 : tier === 'flex' || tier === 'fast' || tier === 'priority' ? pricing.serviceTierMultipliers?.[tier] : undefined;
	if (tierMultiplier === undefined) return null;
	if (!validTokenCount(usage.inputTokens)) return null;
	if (pricing.outputUSDPer1M !== null && !validTokenCount(usage.outputTokens)) return null;

	const inputTokens = usage.inputTokens;
	const outputTokens = tokenCountOrZero(usage.outputTokens);

	if (inputTokens + outputTokens === 0) return null;

	const cachedTokens = Math.min(tokenCountOrZero(usage.cachedTokens), inputTokens);
	const cacheWriteTokens = Math.min(
		tokenCountOrZero(usage.cacheWriteTokens),
		inputTokens - cachedTokens,
	);

	if (cacheWriteTokens > 0 && pricing.cacheWriteInputMultiplier === undefined) return null;

	const uncachedInputTokens = inputTokens - cachedTokens - cacheWriteTokens;
	const longContext = pricing.longContextInputTokenThreshold !== undefined
		&& inputTokens > pricing.longContextInputTokenThreshold;
	const inputMultiplier = longContext ? pricing.longContextInputMultiplier ?? 1 : 1;
	const outputMultiplier = longContext ? pricing.longContextOutputMultiplier ?? 1 : 1;
	const inputRate = pricing.inputUSDPer1M * inputMultiplier;
	const cachedInputRate = (pricing.cachedInputUSDPer1M ?? pricing.inputUSDPer1M) * inputMultiplier;
	const cacheWriteInputRate = inputRate * (pricing.cacheWriteInputMultiplier ?? 1);
	const outputRate = (pricing.outputUSDPer1M ?? 0) * outputMultiplier;
	const cost = (
		(uncachedInputTokens * inputRate)
		+ (cachedTokens * cachedInputRate)
		+ (cacheWriteTokens * cacheWriteInputRate)
		+ (outputTokens * outputRate)
	) * tierMultiplier / TOKENS_PER_PRICING_UNIT;

	return Math.round(cost * COST_PRECISION) / COST_PRECISION;
}

/**
 * Calculates aggregate model cost from the individual requests in an agent run.
 *
 * Per-request calculation is required because long-context pricing applies to
 * an individual prompt rather than to the run's aggregate input-token total.
 *
 * @param model - Provider model used for each request entry.
 * @param entries - Individual request usage entries reported by the Agents SDK.
 * @returns Combined model cost, or null when any request cannot be priced.
 */
export function calculateAIRequestEntriesCostUSD(
	model: string,
	entries: AIRequestCostUsageEntry[],
): number | null {
	if (entries.length === 0) return null;

	let cost = 0;

	for (const entry of entries) {
		const entryCost = calculateAIRequestCostUSD(entry.model ?? model, entry);

		if (entryCost === null) return null;

		cost += entryCost;
	}

	return roundCost(cost);
}

/**
 * Calculates an estimated image generation USD cost from provider usage.
 *
 * Unknown models and incomplete token modality details return null so callers
 * do not persist misleading image costs.
 *
 * @param model - Provider image model used by the request.
 * @param usage - Normalized image token counts from the provider response.
 * @returns Rounded USD cost, or null when cost cannot be computed.
 */
export function calculateAIImageRequestCostUSD(
	model: string,
	usage: AIImageRequestCostUsage,
): number | null {
	const pricing = AI_IMAGE_MODEL_PRICING[canonicalModelName(model)];

	if (!pricing) return null;
	if (!validTokenCount(usage.inputTextTokens)) return null;
	if (!validTokenCount(usage.inputImageTokens)) return null;
	if (!validTokenCount(usage.outputImageTokens)) return null;

	const cachedTextTokens = Math.min(tokenCountOrZero(usage.cachedTextTokens), usage.inputTextTokens);
	const cachedImageTokens = Math.min(tokenCountOrZero(usage.cachedImageTokens), usage.inputImageTokens);
	const uncachedTextTokens = usage.inputTextTokens - cachedTextTokens;
	const uncachedImageTokens = usage.inputImageTokens - cachedImageTokens;
	const cachedTextRate = pricing.cachedTextInputUSDPer1M ?? pricing.textInputUSDPer1M;
	const cachedImageRate = pricing.cachedImageInputUSDPer1M ?? pricing.imageInputUSDPer1M;
	const cost = (
		(uncachedTextTokens * pricing.textInputUSDPer1M)
		+ (cachedTextTokens * cachedTextRate)
		+ (uncachedImageTokens * pricing.imageInputUSDPer1M)
		+ (cachedImageTokens * cachedImageRate)
		+ (usage.outputImageTokens * pricing.imageOutputUSDPer1M)
	) / TOKENS_PER_PRICING_UNIT;

	return Math.round(cost * COST_PRECISION) / COST_PRECISION;
}

/**
 * Calculates hosted provider-tool fees from normalized billable call counts.
 *
 * Unknown tool names are excluded from this numeric subtotal. Use
 * `calculateAIHostedToolCost(...)` when the caller must distinguish a complete
 * cost from a subtotal with unpriced tools.
 *
 * @param usage - Billable hosted-tool call counts by normalized tool name.
 * @returns Hosted-tool cost rounded to the request-cost precision.
 */
export function calculateAIHostedToolCostUSD(usage: AIHostedToolUsage): number {
	return calculateAIHostedToolCost(usage).costUSD;
}

/**
 * Separates priced hosted-tool fees from completed hosted tools whose provider
 * pricing is not yet represented locally.
 *
 * @param usage - Billable hosted-tool call counts by normalized tool name.
 * @returns Known tool-fee subtotal and usage that prevents a complete estimate.
 */
export function calculateAIHostedToolCost(usage: AIHostedToolUsage): AIHostedToolCost {
	const unpricedUsage: AIHostedToolUsage = {};
	let costUSD = 0;

	for (const [toolName, count] of Object.entries(usage)) {
		if (!validTokenCount(count)) continue;

		const completedCalls = Math.trunc(count);

		if (completedCalls === 0) continue;

		const price = AI_HOSTED_TOOL_PRICING_USD[toolName];

		if (price === undefined) {
			unpricedUsage[toolName] = completedCalls;
			continue;
		}

		costUSD += completedCalls * price;
	}

	return {
		costUSD: roundCost(costUSD),
		unpricedUsage,
	};
}

/**
 * Adds provider token cost and hosted-tool fees for one tracked request.
 *
 * A missing token-model price keeps the request unpriced rather than persisting
 * a partial hosted-tool-only total.
 *
 * @param modelCostUSD - Token cost calculated for the model request.
 * @param hostedToolCostUSD - Hosted provider-tool fees incurred during the request.
 * @returns Combined request cost, or null when the model cost is unavailable.
 */
export function combineAIRequestCostUSD(
	modelCostUSD: number | null,
	hostedToolCostUSD: number,
): number | null {
	if (modelCostUSD === null) return null;

	return roundCost(modelCostUSD + hostedToolCostUSD);
}

/**
 * Checks whether a provider token count is present and safe to use in math.
 *
 * @param value - Token count candidate.
 * @returns True when the value is a finite, non-negative number.
 */
function validTokenCount(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Converts optional token counts into a numeric value for optional dimensions.
 *
 * @param value - Token count candidate.
 * @returns Token count, or zero when the value is absent or invalid.
 */
function tokenCountOrZero(value: number | null | undefined): number {
	return validTokenCount(value) ? value : 0;
}

/**
 * Resolves provider aliases and dated snapshots onto one stable pricing key.
 *
 * @param model - Provider model id recorded on the request.
 * @returns Canonical local pricing key.
 */
function canonicalModelName(model: string): string {
	const undated = model.replace(/-\d{4}-\d{2}-\d{2}$/u, '');

	if (undated === 'gpt-5.6') return 'gpt-5.6-sol';

	return undated;
}

/**
 * Rounds a USD cost to the precision stored in `ai_requests.cost_usd`.
 *
 * @param value - Cost value to round.
 * @returns Value rounded to eight decimal places.
 */
function roundCost(value: number): number {
	return Math.round(value * COST_PRECISION) / COST_PRECISION;
}
