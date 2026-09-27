import type { ResponsesProviderCallInput, ResponsesProviderCallResult } from './contracts/ResponsesProviderCall';
export type { ResponsesProviderCallInput, ResponsesProviderCallResult } from './contracts/ResponsesProviderCall';
import { providerResponseMetadata } from './AIRateLimiter.js';
import type { TextResponsePayloadWithUsage } from './contracts/AI.js';

/**
 * Sends one Responses API request to an OpenAI-compatible provider.
 *
 * This is pure transport: it performs the HTTP call and parses the payload and
 * headers. Tracking, rate limiting, failover policy, and error shaping stay in
 * the AI service so every attempt in a failover chain shares one lifecycle.
 *
 * @param input - Provider connection, request payload, and fetch implementation.
 * @returns Raw provider response for the caller to classify.
 */
export async function sendResponsesRequest(input: ResponsesProviderCallInput): Promise<ResponsesProviderCallResult> {
	const response = await input.fetcher(`${input.baseUrl}/responses`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${input.apiKey}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify(input.request),
	});
	const metadata = providerResponseMetadata(response.headers);
	const payload = await response.json().catch(() => null) as TextResponsePayloadWithUsage | null;

	return {
		ok: response.ok,
		status: response.status,
		payload,
		metadata,
	};
}
