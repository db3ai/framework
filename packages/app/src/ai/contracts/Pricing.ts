/**
 * Standard per-token pricing for one model on a provider endpoint.
 *
 * Prices are stored per one million tokens because that is how OpenAI publishes
 * the rates. `outputUSDPer1M` is null for input-only models such as embeddings.
 */
export interface AIModelPricing {
	inputUSDPer1M: number;
	cachedInputUSDPer1M: number | null;
	outputUSDPer1M: number | null;
	/**
	 * Multiplier applied to input tokens written into the provider prompt cache.
	 *
	 * GPT-5.6 and GPT-6 models report cache writes separately and bill them above
	 * the ordinary uncached input rate. Models without that charge omit it.
	 */
	cacheWriteInputMultiplier?: number;
	/**
	 * Input-token threshold above which the full request uses long-context rates.
	 */
	longContextInputTokenThreshold?: number;
	/**
	 * Multiplier applied to uncached and cached input rates above the threshold.
	 */
	longContextInputMultiplier?: number;
	/**
	 * Multiplier applied to the output rate above the threshold.
	 */
	longContextOutputMultiplier?: number;
}

/**
 * Per-modality pricing for OpenAI image generation models.
 *
 * Image model pricing separates text input, image input, and image output token
 * rates, so it cannot be represented safely by the generic text-model table.
 */
export interface AIImageModelPricing {
	textInputUSDPer1M: number;
	cachedTextInputUSDPer1M: number | null;
	imageInputUSDPer1M: number;
	cachedImageInputUSDPer1M: number | null;
	imageOutputUSDPer1M: number;
}

/**
 * Normalized token counts captured from a tracked AI provider response.
 */
export interface AIRequestCostUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens?: number | null;
	/** Input tokens written into a billable provider prompt cache. */
	cacheWriteTokens?: number | null;
}

/**
 * Per-provider-request usage retained from an aggregate Agents SDK run.
 */
export interface AIRequestCostUsageEntry extends AIRequestCostUsage {
	/** Provider endpoint that reported this usage entry, when available. */
	endpoint?: string;
}

/**
 * Normalized token counts captured from an image generation response.
 */
export interface AIImageRequestCostUsage {
	inputTextTokens: number | null;
	inputImageTokens: number | null;
	outputImageTokens: number | null;
	cachedTextTokens?: number | null;
	cachedImageTokens?: number | null;
}

/**
 * Hosted provider-tool call counts keyed by the normalized tool name.
 */
export type AIHostedToolUsage = Record<string, number>;

/**
 * Priced and unpriced portions of the hosted provider tools used by one request.
 *
 * A request with an unpriced hosted tool must not present a partial value as its
 * complete provider cost. The known subtotal remains useful for investigation,
 * while the caller can leave the request cost unpriced until a pricing rule is
 * added for that tool.
 */
export interface AIHostedToolCost {
	/** USD subtotal for hosted tools with an explicit pricing rule. */
	costUSD: number;

	/** Completed hosted tools that do not yet have a trusted pricing rule. */
	unpricedUsage: AIHostedToolUsage;
}
