/**
 * Cost totals for one root AI request and every recursively linked child request.
 */
export interface AiRequestRunCostSummary {
	/** Root request used to build the request tree. */
	rootAiRequestId: string;
	/** Number of tracked request rows in the tree, including the root. */
	requestCount: number;
	/** Provider operations represented by the tracked rows. */
	providerRequestCount: number;
	/** Combined input tokens reported by the request tree. */
	inputTokens: number;
	/** Combined output tokens reported by the request tree. */
	outputTokens: number;
	/** Combined total tokens reported by the request tree. */
	totalTokens: number;
	/** Combined reasoning output tokens reported by the request tree. */
	reasoningTokens: number;
	/** Combined cached input tokens reported by the request tree. */
	cachedTokens: number;
	/** Combined billable prompt-cache write tokens reported by the request tree. */
	cacheWriteTokens: number;
	/** Known cost persisted directly on the root request. */
	rootCostUSD: number;
	/** Combined known cost of all descendant requests. */
	childCostUSD: number;
	/** Combined known root and descendant cost; a lower bound when requests are unpriced. */
	totalCostUSD: number;
	/** Request rows whose complete provider cost is unavailable. */
	unpricedRequestCount: number;
}
