import type { OpenAIQuotaRetryMetadata, OpenAIQuotaRetryDecision } from './contracts/QuotaRetry';
export type { OpenAIQuotaRetryMetadata, OpenAIQuotaRetryDecision } from './contracts/QuotaRetry';
import type { AiRequest } from './AiRequest.js';
import { isOpenAIQuotaError, openAIProviderError } from './OpenAIProviderError';

const OPENAI_QUOTA_RETRY_METADATA_KEY = 'openAIQuotaRetry';

/**
 * Builds a bounded exponential retry decision for an OpenAI quota failure.
 *
 * @param error - Unknown provider error thrown by the Agents SDK.
 * @param request - Persisted AI request carrying previous quota retry metadata.
 * @param now - Current time used for deterministic scheduling.
 * @returns Quota retry decision, or null for another failure category.
 */
export function openAIQuotaRetryDecision(
	error: unknown,
	request: AiRequest,
	now = new Date(),
): OpenAIQuotaRetryDecision | null {
	if (!isOpenAIQuotaError(error)) return null;

	const providerError = openAIProviderError(error);
	const previous = quotaRetryMetadata(request.metadata);
	const deferralCount = (previous?.deferralCount ?? 0) + 1;
	const firstDeferredAt = validDate(previous?.firstDeferredAt)
		?? request.startedAt
		?? request.createdAt
		?? now;
	const retryUntil = validDate(previous?.retryUntil)
		?? new Date(firstDeferredAt.getTime() + (quotaRetryWindowSeconds() * 1000));
	const expired = now.getTime() >= retryUntil.getTime();
	const delaySeconds = expired
		? 0
		: Math.min(
			quotaRetryMaxSeconds(),
			quotaRetryInitialSeconds() * (2 ** Math.max(0, deferralCount - 1)),
		);
	const retryAt = new Date(Math.min(
		retryUntil.getTime(),
		now.getTime() + (delaySeconds * 1000),
	));
	const code = providerError.code ?? 'insufficient_quota';

	return {
		code,
		message: providerError.message,
		deferralCount,
		delaySeconds,
		retryAt,
		retryUntil,
		expired,
		metadata: {
			code,
			deferralCount,
			firstDeferredAt: firstDeferredAt.toISOString(),
			lastDeferredAt: now.toISOString(),
			retryAt: retryAt.toISOString(),
			retryUntil: retryUntil.toISOString(),
		},
	};
}

/**
 * Merges quota retry state into existing AI request metadata.
 *
 * @param metadata - Existing request metadata.
 * @param quotaRetry - Quota retry state to persist.
 * @returns Request metadata containing the latest retry schedule.
 */
export function withOpenAIQuotaRetryMetadata(
	metadata: Record<string, unknown> | null,
	quotaRetry: OpenAIQuotaRetryMetadata,
): Record<string, unknown> {
	return {
		...(metadata ?? {}),
		[OPENAI_QUOTA_RETRY_METADATA_KEY]: quotaRetry,
	};
}

/**
 * Removes completed quota retry state from AI request metadata.
 *
 * @param metadata - Existing request metadata.
 * @returns Metadata without the internal quota retry entry.
 */
export function withoutOpenAIQuotaRetryMetadata(
	metadata: Record<string, unknown> | null,
): Record<string, unknown> {
	const next = {
		...(metadata ?? {}),
	};

	delete next[OPENAI_QUOTA_RETRY_METADATA_KEY];

	return next;
}

/**
 * Reads validated quota retry metadata from an AI request metadata object.
 *
 * @param metadata - Existing request metadata.
 * @returns Persisted quota retry state, or null.
 */
function quotaRetryMetadata(
	metadata: Record<string, unknown> | null,
): OpenAIQuotaRetryMetadata | null {
	const value = metadata?.[OPENAI_QUOTA_RETRY_METADATA_KEY];

	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

	const record = value as Record<string, unknown>;

	if (
		typeof record.code !== 'string'
		|| typeof record.deferralCount !== 'number'
		|| typeof record.firstDeferredAt !== 'string'
		|| typeof record.lastDeferredAt !== 'string'
		|| typeof record.retryAt !== 'string'
		|| typeof record.retryUntil !== 'string'
	) {
		return null;
	}

	return record as OpenAIQuotaRetryMetadata;
}

/**
 * Parses one valid date-like value.
 *
 * @param value - Unknown persisted date value.
 * @returns Valid date, or null.
 */
function validDate(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value !== 'string' || !value.trim()) return null;

	const date = new Date(value);

	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Returns the first quota retry delay in seconds.
 *
 * @returns Positive retry delay.
 */
function quotaRetryInitialSeconds(): number {
	return positiveEnvironmentNumber('OPENAI_QUOTA_RETRY_INITIAL_SECONDS', 900);
}

/**
 * Returns the maximum quota retry delay in seconds.
 *
 * @returns Positive maximum retry delay.
 */
function quotaRetryMaxSeconds(): number {
	return positiveEnvironmentNumber('OPENAI_QUOTA_RETRY_MAX_SECONDS', 3600);
}

/**
 * Returns the total quota retry window in seconds.
 *
 * @returns Positive retry window.
 */
function quotaRetryWindowSeconds(): number {
	return positiveEnvironmentNumber('OPENAI_QUOTA_RETRY_WINDOW_SECONDS', 86400);
}

/**
 * Reads a positive finite environment number.
 *
 * @param name - Environment variable name.
 * @param fallback - Value used when configuration is absent or invalid.
 * @returns Positive finite number.
 */
function positiveEnvironmentNumber(name: string, fallback: number): number {
	const value = Number(process.env[name]);

	return Number.isFinite(value) && value > 0
		? value
		: fallback;
}
