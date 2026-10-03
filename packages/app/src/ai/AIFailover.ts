import { AIProviderDeferredError, AIProviderStoppedError } from './AIProviderAdmission';
import { AIRateLimitDeferredError } from './AIRateLimiter.js';
import { openAIProviderError, isOpenAIQuotaError } from './OpenAIProviderError.js';

const FAILOVERABLE_STATUS_CODES = new Set([408, 409, 429]);

const FAILOVERABLE_ERROR_CODES = new Set([
	'rate_limit_exceeded',
	'insufficient_quota',
	'billing_hard_limit_reached',
	'overloaded',
	'overloaded_error',
	'server_error',
	'service_unavailable',
]);

const NETWORK_ERROR_NAMES = new Set([
	'AbortError',
	'TimeoutError',
	'APIConnectionError',
	'APIConnectionTimeoutError',
	'ConnectTimeoutError',
	'FetchError',
]);

const NETWORK_ERROR_CODES = new Set([
	'ETIMEDOUT',
	'ECONNRESET',
	'ECONNREFUSED',
	'ENOTFOUND',
	'EAI_AGAIN',
	'EPIPE',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_SOCKET',
]);

/**
 * Decides whether a provider HTTP response should fail over to the next provider.
 *
 * Failover is reserved for transient availability problems and exhausted
 * account capacity: rate limits, overload, 5xx, timeouts, and quota. Request
 * problems such as validation or authentication failures stay terminal because
 * retrying them on another provider repeats the same failure at extra cost.
 *
 * @param status - HTTP response status.
 * @param payload - Parsed provider response payload.
 * @returns True when the next provider in the chain should be attempted.
 */
export function isFailoverableResponse(status: number, payload: unknown): boolean {
	if (FAILOVERABLE_STATUS_CODES.has(status) || status >= 500) return true;
	if (isOpenAIQuotaError(payload)) return true;

	const code = openAIProviderError(payload).code;

	return code !== null && FAILOVERABLE_ERROR_CODES.has(code);
}

/**
 * Decides whether a thrown provider or SDK failure should fail over.
 *
 * Local rate-limit deferrals count as failoverable because a full local bucket
 * for one provider says nothing about the capacity of the next provider.
 * Streaming SDK failures may carry a provider code without an HTTP status, so
 * classification never relies on status alone.
 *
 * @param error - Unknown thrown value from a provider call or SDK run.
 * @returns True when the next provider in the chain should be attempted.
 */
export function isFailoverableFailure(error: unknown): boolean {
	if (error instanceof AIRateLimitDeferredError || error instanceof AIProviderDeferredError || error instanceof AIProviderStoppedError) return true;
	if (isNetworkFailure(error)) return true;

	const details = openAIProviderError(error);

	if (details.code !== null && FAILOVERABLE_ERROR_CODES.has(details.code)) return true;
	if (details.status !== null && (FAILOVERABLE_STATUS_CODES.has(details.status) || details.status >= 500)) return true;

	return false;
}

/**
 * Detects network, DNS, and timeout failures from fetch and SDK clients.
 *
 * Undici wraps socket errors inside `TypeError: fetch failed` with the real
 * failure on `cause`, so the check walks the cause chain.
 *
 * @param error - Unknown thrown value.
 * @returns True when the failure happened before a provider response arrived.
 */
export function isNetworkFailure(error: unknown, depth = 0): boolean {
	if ((!(error instanceof Error) && !(error instanceof DOMException)) || depth > 4) return false;
	if (NETWORK_ERROR_NAMES.has(error.name)) return true;
	if (error instanceof TypeError && error.message.includes('fetch failed')) return true;

	const code = (error as Error & { code?: unknown }).code;

	if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;

	return isNetworkFailure(error.cause, depth + 1);
}
