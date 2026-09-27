import type { AiRequest } from '../AiRequest';
import type { AiRateLimitBucket, AiRateLimitEndpoint } from '../AiRateLimitBucket';
import type { AiRateLimitReservation } from '../AiRateLimitReservation';
import type { AIProvider } from './AI';

/** Provider operation and estimated capacity to reserve before external work begins. */
export interface AIRateLimitAcquireInput {
	provider?: AIProvider;
	endpoint: AiRateLimitEndpoint;
	model: string;
	operation: string;
	estimatedTokens?: number | null;
	aiRequest?: AiRequest | null;
}

/** Reservation that must be settled or released after one provider operation. */
export interface AIRateLimitLease {
	bucketKey: string;
	bucket: AiRateLimitBucket | null;
	reservation: AiRateLimitReservation | null;
	endpoint: AiRateLimitEndpoint;
	model: string;
	operation: string;
}

/** Provider-reported capacity and reset times observed from response headers. */
export interface AIRateLimitSnapshot {
	observedAt: string;
	headers: Record<string, string>;
	limitRequests: number | null;
	remainingRequests: number | null;
	requestsResetAfterMs: number | null;
	requestsResetAt: string | null;
	limitTokens: number | null;
	remainingTokens: number | null;
	tokensResetAfterMs: number | null;
	tokensResetAt: string | null;
	limitProjectTokens: number | null;
	remainingProjectTokens: number | null;
	projectTokensResetAfterMs: number | null;
	projectTokensResetAt: string | null;
}

/** Provider request identity, processing time and observed rate-limit capacity. */
export interface AIProviderResponseMetadata {
	providerRequestId: string | null;
	providerProcessingMs: number | null;
	rateLimitSnapshot: AIRateLimitSnapshot | null;
}
