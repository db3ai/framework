import type { AIProviderResponseMetadata } from './RateLimits';
import type { TextResponsePayloadWithUsage } from './AI';

/**
 * One OpenAI-compatible Responses API request against a specific provider.
 */
export interface ResponsesProviderCallInput {
	/** Provider base URL without the /responses suffix. */
	baseUrl: string;
	/** Provider API key sent as a bearer token. */
	apiKey: string;
	/** Serialized Responses API request payload. */
	request: Record<string, unknown>;
	/** Fetch implementation used to send the request. */
	fetcher: typeof fetch;
}

/**
 * Raw transport result for one provider attempt, before tracking or error policy.
 */
export interface ResponsesProviderCallResult {
	/** Whether the provider returned a 2xx response. */
	ok: boolean;
	/** HTTP status returned by the provider. */
	status: number;
	/** Parsed JSON payload, or null when the body was not JSON. */
	payload: TextResponsePayloadWithUsage | null;
	/** Parsed provider rate-limit and request-id headers. */
	metadata: AIProviderResponseMetadata;
}
