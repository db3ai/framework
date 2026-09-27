/**
 * Persisted quota retry metadata stored on the tracked AI request.
 */
export interface OpenAIQuotaRetryMetadata extends Record<string, unknown> {
	/** Provider error code that triggered the deferral. */
	code: string;
	/** Number of quota deferrals recorded for this request. */
	deferralCount: number;
	/** First time quota exhaustion deferred this request. */
	firstDeferredAt: string;
	/** Most recent quota deferral time. */
	lastDeferredAt: string;
	/** Next scheduled provider attempt. */
	retryAt: string;
	/** Absolute time after which another quota failure becomes terminal. */
	retryUntil: string;
}

/**
 * Bounded exponential retry decision for one OpenAI quota failure.
 */
export interface OpenAIQuotaRetryDecision {
	/** Provider error code that triggered quota handling. */
	code: string;
	/** Human-readable provider failure message. */
	message: string;
	/** Number of quota deferrals including the current failure. */
	deferralCount: number;
	/** Seconds before the next provider attempt. */
	delaySeconds: number;
	/** Absolute time of the next provider attempt. */
	retryAt: Date;
	/** Absolute time after which another quota failure becomes terminal. */
	retryUntil: Date;
	/** Whether the request has exhausted its quota-retry window. */
	expired: boolean;
	/** Metadata to persist on the tracked AI request. */
	metadata: OpenAIQuotaRetryMetadata;
}
