import type { AIRateLimitAcquireInput, AIRateLimitLease, AIRateLimitSnapshot, AIProviderResponseMetadata } from './contracts/RateLimits';
export type { AIRateLimitAcquireInput, AIRateLimitLease, AIRateLimitSnapshot, AIProviderResponseMetadata } from './contracts/RateLimits';
import { QueueRetryLaterError } from '@db3.ai/app/queue';
import { ActiveRecord } from '@db3.ai/app/db';
import { app } from '../server/appContext';

import { AI_RATE_LIMIT_ENDPOINT, AiRateLimitBucket, type AiRateLimitEndpoint } from './AiRateLimitBucket';
import { AiRateLimitReservation } from './AiRateLimitReservation';
import { AI_PROVIDER, type AIProvider } from './contracts/AI.js';

const DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_ACTIVE_BUCKET_DELAY_SECONDS = 1;
const UNKNOWN_RESET_DELAY_SECONDS = 60;
const ONE_MINUTE_MS = 60 * 1000;

const OPENAI_GPT_IMAGE_2_TIER_1_RATE_LIMIT: ProviderDefaultRateLimit = {
	limitRequests: 5,
	limitTokens: 100_000,
	windowMs: ONE_MINUTE_MS,
	source: 'openai:gpt-image-2:tier-1',
};

const RATE_LIMIT_HEADER_NAMES = [
	'x-ratelimit-limit-requests',
	'x-ratelimit-limit-tokens',
	'x-ratelimit-remaining-requests',
	'x-ratelimit-remaining-tokens',
	'x-ratelimit-reset-requests',
	'x-ratelimit-reset-tokens',
	'x-ratelimit-limit-project-tokens',
	'x-ratelimit-remaining-project-tokens',
	'x-ratelimit-reset-project-tokens',
] as const;

interface ActiveReservationTotals {
	requests: number;
	tokens: number;
}

interface CapacityDelay {
	delaySeconds: number;
	resetAt: Date | null;
	reason: string;
}

/**
 * Conservative local limit used when a provider publishes a limit but omits it
 * from response headers for a known model/endpoint bucket.
 */
interface ProviderDefaultRateLimit {
	limitRequests: number | null;
	limitTokens: number | null;
	windowMs: number;
	source: string;
}

/**
 * Coordinates OpenAI provider calls against the latest observed rate-limit state.
 */
export class AIRateLimiter {
	/**
	 * Reserves capacity for one provider request.
	 *
	 * @param input - Provider endpoint, model, and estimated request size.
	 * @returns Reservation lease that must be observed or released after the call.
	 */
	async acquire(input: AIRateLimitAcquireInput): Promise<AIRateLimitLease> {
		const provider = input.provider ?? AI_PROVIDER.openai;
		const bucketKey = aiRateLimitBucketKey(provider, input.endpoint, input.model);
		const estimatedTokens = normalizeReservedTokens(input.estimatedTokens);

		if (process.env.AI_RATE_LIMITER_DISABLED === 'true') {
			return emptyLease(input, bucketKey);
		}

		return await app().db.transaction(async database => {
			const now = new Date();
			const bucket = await this.findOrCreateBucket({
				provider,
				endpoint: input.endpoint,
				limitKey: input.model,
				bucketKey,
			});
			const defaultRateLimit = providerDefaultRateLimit(provider, input.endpoint, input.model);

			if (defaultRateLimit && applyDefaultRateLimitBucketState(bucket, defaultRateLimit, now)) {
				await bucket.save();
			}

			const activeReservations = await activeReservationTotals(String(bucket.id), now);
			const delay = capacityDelay(bucket, activeReservations, estimatedTokens, now);

			if (delay) {
				throw new AIRateLimitDeferredError(
					delay.delaySeconds,
					bucketKey,
					delay.resetAt,
					`AI rate limit bucket "${bucketKey}" is waiting for ${delay.reason}.`,
				);
			}

			const reservation = await new AiRateLimitReservation({
				bucket,
				aiRequest: input.aiRequest ?? null,
				operation: input.operation,
				reservedRequests: 1,
				reservedTokens: estimatedTokens,
				expiresAt: new Date(now.getTime() + DEFAULT_RESERVATION_TTL_MS),
			}).save();

			return {
				bucketKey,
				bucket,
				reservation,
				endpoint: input.endpoint,
				model: input.model,
				operation: input.operation,
			};
		});
	}

	/**
	 * Updates bucket state from provider response headers and releases the lease.
	 *
	 * @param lease - Reservation returned from acquire().
	 * @param metadata - Parsed response header metadata.
	 */
	async observe(
		lease: AIRateLimitLease | null,
		metadata: AIProviderResponseMetadata,
	): Promise<void> {
		if (!lease?.bucket) return;

		try {
			const defaultRateLimit = providerDefaultRateLimit(
				lease.bucket.provider as AIProvider,
				lease.endpoint,
				lease.model,
			);
			const shouldStoreMetadata = Boolean(metadata.rateLimitSnapshot || metadata.providerRequestId);

			if (shouldStoreMetadata) {
				applyRateLimitMetadata(lease.bucket, metadata);
			}

			const shouldConsumeDefault = defaultRateLimit
				? consumeDefaultRateLimitCapacity(
					lease.bucket,
					defaultRateLimit,
					lease.reservation?.reservedTokens ?? 0,
					metadata.rateLimitSnapshot,
					new Date(),
				)
				: false;

			if (shouldConsumeDefault || shouldStoreMetadata) {
				await lease.bucket.save();
			}
		} finally {
			await this.release(lease);
		}
	}

	/**
	 * Releases a lease without changing bucket state.
	 *
	 * @param lease - Reservation returned from acquire().
	 */
	async release(lease: AIRateLimitLease | null): Promise<void> {
		if (!lease?.reservation?.id) return;

		if (!lease.reservation.releasedAt) {
			lease.reservation.assign({
				releasedAt: new Date(),
			});

			await lease.reservation.save();
		}

		try {
			await AiRateLimitReservation.cleanupReleasedAndExpired();
		} catch {
			// The row is already released, so cleanup should not fail completed AI calls.
		}
	}

	/**
	 * Finds or creates a bucket row in the current database scope.
	 *
	 * @param input - Stable bucket identity.
	 * @returns Persisted bucket row.
	 */
	private async findOrCreateBucket(input: {
		provider: AIProvider;
		endpoint: AiRateLimitEndpoint;
		limitKey: string;
		bucketKey: string;
	}): Promise<AiRateLimitBucket> {
		const existing = await lockedBucket(input.bucketKey);

		if (existing) return existing;

		try {
			return await new AiRateLimitBucket({
				bucketKey: input.bucketKey,
				provider: input.provider,
				endpoint: input.endpoint,
				limitKey: input.limitKey,
			}).save();
		} catch (error) {
			const raced = await lockedBucket(input.bucketKey);

			if (raced) return raced;

			throw error;
		}
	}
}

/**
 * Rate-limit deferral that also satisfies the framework queue retry-later contract.
 */
export class AIRateLimitDeferredError extends QueueRetryLaterError {
	/**
	 * Create a provider rate-limit deferral.
	 *
	 * @param delaySeconds - Number of seconds before retrying the provider call.
	 * @param bucketKey - Rate-limit bucket that caused the deferral.
	 * @param resetAt - Absolute provider reset time, when known.
	 * @param message - Human-readable explanation.
	 */
	constructor(
		delaySeconds: number,
		readonly bucketKey: string,
		readonly resetAt: Date | null,
		message: string,
	) {
		super(delaySeconds, message);
		this.name = 'AIRateLimitDeferredError';
	}
}

/**
 * Builds the stable bucket key used to separate provider endpoint families.
 *
 * @param provider - AI provider id.
 * @param endpoint - Provider endpoint family.
 * @param limitKey - Model or shared-limit key.
 * @returns Stable bucket key.
 */
export function aiRateLimitBucketKey(
	provider: AIProvider,
	endpoint: AiRateLimitEndpoint,
	limitKey: string,
): string {
	return `${provider}:${endpoint}:${limitKey}`;
}

/**
 * Extracts request-id and rate-limit metadata from provider response headers.
 *
 * @param headers - HTTP response headers.
 * @param observedAt - Time the response was observed.
 * @returns Parsed provider metadata.
 */
export function providerResponseMetadata(
	headers: Headers,
	observedAt: Date = new Date(),
): AIProviderResponseMetadata {
	const providerRequestId = headerString(headers, 'x-request-id');
	const providerProcessingMs = integerHeader(headers, 'openai-processing-ms');

	return {
		providerRequestId,
		providerProcessingMs,
		rateLimitSnapshot: parseAIRateLimitHeaders(headers, observedAt),
	};
}

/**
 * Parses OpenAI x-ratelimit response headers into a JSON-safe snapshot.
 *
 * @param headers - HTTP response headers.
 * @param observedAt - Time the response was observed.
 * @returns Parsed snapshot, or null when no rate-limit headers are present.
 */
export function parseAIRateLimitHeaders(
	headers: Headers,
	observedAt: Date = new Date(),
): AIRateLimitSnapshot | null {
	const rawHeaders = rateLimitHeaders(headers);

	if (Object.keys(rawHeaders).length === 0) return null;

	const requestsResetAfterMs = resetHeaderMs(headers, 'x-ratelimit-reset-requests');
	const tokensResetAfterMs = resetHeaderMs(headers, 'x-ratelimit-reset-tokens');
	const projectTokensResetAfterMs = resetHeaderMs(headers, 'x-ratelimit-reset-project-tokens');

	return {
		observedAt: observedAt.toISOString(),
		headers: rawHeaders,
		limitRequests: integerHeader(headers, 'x-ratelimit-limit-requests'),
		remainingRequests: integerHeader(headers, 'x-ratelimit-remaining-requests'),
		requestsResetAfterMs,
		requestsResetAt: resetAtIso(observedAt, requestsResetAfterMs),
		limitTokens: integerHeader(headers, 'x-ratelimit-limit-tokens'),
		remainingTokens: integerHeader(headers, 'x-ratelimit-remaining-tokens'),
		tokensResetAfterMs,
		tokensResetAt: resetAtIso(observedAt, tokensResetAfterMs),
		limitProjectTokens: integerHeader(headers, 'x-ratelimit-limit-project-tokens'),
		remainingProjectTokens: integerHeader(headers, 'x-ratelimit-remaining-project-tokens'),
		projectTokensResetAfterMs,
		projectTokensResetAt: resetAtIso(observedAt, projectTokensResetAfterMs),
	};
}

/**
 * Parses OpenAI reset duration headers such as "1s", "6m0s", or "250ms".
 *
 * @param value - Header duration value.
 * @returns Duration in milliseconds, or null when unparseable.
 */
export function parseRateLimitResetMs(value: string | null): number | null {
	if (!value) return null;

	const normalized = value.trim().toLowerCase();
	const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
	let match: RegExpExecArray | null;
	let total = 0;
	let matched = false;

	while ((match = pattern.exec(normalized)) !== null) {
		matched = true;
		const amount = Number(match[1]);
		const unit = match[2];

		if (!Number.isFinite(amount)) continue;

		if (unit === 'ms') total += amount;
		if (unit === 's') total += amount * 1000;
		if (unit === 'm') total += amount * 60 * 1000;
		if (unit === 'h') total += amount * 60 * 60 * 1000;
	}

	if (!matched) return null;

	return Math.max(0, Math.ceil(total));
}

/**
 * Returns the endpoint constant for Responses API calls.
 *
 * @returns Responses endpoint value.
 */
export function responsesRateLimitEndpoint(): AiRateLimitEndpoint {
	return AI_RATE_LIMIT_ENDPOINT.responses;
}

/**
 * Returns the endpoint constant for Embeddings API calls.
 *
 * @returns Embeddings endpoint value.
 */
export function embeddingsRateLimitEndpoint(): AiRateLimitEndpoint {
	return AI_RATE_LIMIT_ENDPOINT.embeddings;
}

/**
 * Returns the endpoint constant for Images API calls.
 *
 * @returns Images endpoint value.
 */
export function imagesRateLimitEndpoint(): AiRateLimitEndpoint {
	return AI_RATE_LIMIT_ENDPOINT.images;
}

/**
 * Applies parsed provider metadata to a persisted bucket model.
 *
 * @param bucket - Bucket to update.
 * @param metadata - Parsed provider response metadata.
 */
function applyRateLimitMetadata(
	bucket: AiRateLimitBucket,
	metadata: AIProviderResponseMetadata,
): void {
	const snapshot = metadata.rateLimitSnapshot;
	const changes: Record<string, unknown> = {
		lastProviderRequestId: metadata.providerRequestId,
		lastObservedAt: new Date(),
	};

	if (snapshot) {
		assignPresentRateLimitSnapshot(changes, snapshot);
	}

	bucket.assign(changes);
}

/**
 * Copies only observed header dimensions into a bucket update.
 *
 * Partial OpenAI responses should not erase dimensions that are maintained by a
 * model-specific fallback, such as GPT Image 2 request-per-minute capacity.
 *
 * @param changes - Mutable bucket assignment object.
 * @param snapshot - Parsed provider rate-limit snapshot.
 */
function assignPresentRateLimitSnapshot(
	changes: Record<string, unknown>,
	snapshot: AIRateLimitSnapshot,
): void {
	if (snapshot.limitRequests !== null) changes.limitRequests = snapshot.limitRequests;
	if (snapshot.remainingRequests !== null) changes.remainingRequests = snapshot.remainingRequests;
	if (snapshot.requestsResetAt !== null) changes.requestsResetAt = new Date(snapshot.requestsResetAt);
	if (snapshot.limitTokens !== null) changes.limitTokens = snapshot.limitTokens;
	if (snapshot.remainingTokens !== null) changes.remainingTokens = snapshot.remainingTokens;
	if (snapshot.tokensResetAt !== null) changes.tokensResetAt = new Date(snapshot.tokensResetAt);
	if (snapshot.limitProjectTokens !== null) changes.limitProjectTokens = snapshot.limitProjectTokens;
	if (snapshot.remainingProjectTokens !== null) changes.remainingProjectTokens = snapshot.remainingProjectTokens;
	if (snapshot.projectTokensResetAt !== null) changes.projectTokensResetAt = new Date(snapshot.projectTokensResetAt);
}

/**
 * Returns a conservative provider default for buckets whose headers are partial.
 *
 * GPT Image 2 publishes Tier 1 limits as TPM and IPM. The current image helper
 * generates one image per provider call, so IPM is represented as request
 * capacity for this bucket.
 *
 * @param provider - Provider id.
 * @param endpoint - Provider endpoint family.
 * @param model - Provider model or snapshot id.
 * @returns Default limit details, or null when no fallback is known.
 */
function providerDefaultRateLimit(
	provider: AIProvider,
	endpoint: AiRateLimitEndpoint,
	model: string,
): ProviderDefaultRateLimit | null {
	if (provider === AI_PROVIDER.openai && endpoint === AI_RATE_LIMIT_ENDPOINT.images && (model === 'gpt-image-2.5-flare' || model.startsWith('gpt-image-2.5-flare-'))) {
		// Conservative local admission policy, not a claim about the account's provider tier.
		return { limitRequests: 5, limitTokens: null, windowMs: ONE_MINUTE_MS, source: 'local:gpt-image-2.5-flare:conservative' };
	}
	if (
		provider === AI_PROVIDER.openai
		&& endpoint === AI_RATE_LIMIT_ENDPOINT.images
		&& (model === 'gpt-image-2' || model.startsWith('gpt-image-2-'))
	) {
		return OPENAI_GPT_IMAGE_2_TIER_1_RATE_LIMIT;
	}

	return null;
}

/**
 * Initializes missing bucket dimensions from a provider default.
 *
 * Defaults are only used for unknown dimensions. Observed provider header values
 * remain authoritative and are not lowered to the default.
 *
 * @param bucket - Bucket row being acquired.
 * @param defaultRateLimit - Provider fallback limit.
 * @param now - Current time.
 * @returns True when the bucket was changed.
 */
function applyDefaultRateLimitBucketState(
	bucket: AiRateLimitBucket,
	defaultRateLimit: ProviderDefaultRateLimit,
	now: Date,
): boolean {
	let changed = false;

	if (defaultRateLimit.limitRequests !== null) {
		if (bucket.limitRequests === null || bucket.limitRequests === undefined) {
			bucket.limitRequests = defaultRateLimit.limitRequests;
			changed = true;
		}

		if (bucket.remainingRequests === null || bucket.remainingRequests === undefined) {
			bucket.remainingRequests = defaultRateLimit.limitRequests;
			changed = true;
		}

		if (!bucket.requestsResetAt) {
			bucket.requestsResetAt = new Date(now.getTime() + defaultRateLimit.windowMs);
			changed = true;
		}
	}

	if (defaultRateLimit.limitTokens !== null) {
		if (bucket.limitTokens === null || bucket.limitTokens === undefined) {
			bucket.limitTokens = defaultRateLimit.limitTokens;
			changed = true;
		}

		if (bucket.remainingTokens === null || bucket.remainingTokens === undefined) {
			bucket.remainingTokens = defaultRateLimit.limitTokens;
			changed = true;
		}

		if (!bucket.tokensResetAt) {
			bucket.tokensResetAt = new Date(now.getTime() + defaultRateLimit.windowMs);
			changed = true;
		}
	}

	if (changed) {
		bucket.metadata = {
			...(bucket.metadata ?? {}),
			defaultRateLimit: {
				source: defaultRateLimit.source,
				appliedAt: now.toISOString(),
			},
		};
	}

	return changed;
}

/**
 * Locally decrements fallback dimensions that were not returned by the provider.
 *
 * Provider response headers remain authoritative. This only maintains counters
 * for missing dimensions so sequential image calls cannot bypass the Tier 1 IPM
 * fallback once their short-lived reservations are released.
 *
 * @param bucket - Bucket row to update.
 * @param defaultRateLimit - Provider fallback limit.
 * @param reservedTokens - Token estimate reserved for the completed request.
 * @param snapshot - Provider rate-limit snapshot, when returned.
 * @param now - Current time.
 * @returns True when the bucket was changed.
 */
function consumeDefaultRateLimitCapacity(
	bucket: AiRateLimitBucket,
	defaultRateLimit: ProviderDefaultRateLimit,
	reservedTokens: number,
	snapshot: AIRateLimitSnapshot | null,
	now: Date,
): boolean {
	let changed = applyDefaultRateLimitBucketState(bucket, defaultRateLimit, now);

	if (defaultRateLimit.limitRequests !== null && missingSnapshotValue(snapshot?.remainingRequests)) {
		const requestCapacity = currentWindowCapacity(
			bucket.remainingRequests,
			bucket.limitRequests,
			bucket.requestsResetAt,
			now,
		) ?? defaultRateLimit.limitRequests;

		bucket.remainingRequests = Math.max(0, requestCapacity - 1);
		bucket.requestsResetAt = currentOrNextReset(bucket.requestsResetAt, now, defaultRateLimit.windowMs);
		changed = true;
	}

	if (defaultRateLimit.limitTokens !== null && reservedTokens > 0 && missingSnapshotValue(snapshot?.remainingTokens)) {
		const tokenCapacity = currentWindowCapacity(
			bucket.remainingTokens,
			bucket.limitTokens,
			bucket.tokensResetAt,
			now,
		) ?? defaultRateLimit.limitTokens;

		bucket.remainingTokens = Math.max(0, tokenCapacity - reservedTokens);
		bucket.tokensResetAt = currentOrNextReset(bucket.tokensResetAt, now, defaultRateLimit.windowMs);
		changed = true;
	}

	return changed;
}

/**
 * Detects whether a provider snapshot omitted a rate-limit dimension.
 *
 * @param value - Parsed snapshot value.
 * @returns True when the dimension was not supplied by the provider.
 */
function missingSnapshotValue(value: number | null | undefined): boolean {
	return value === null || value === undefined;
}

/**
 * Returns the usable remaining capacity for a possibly elapsed local window.
 *
 * @param remaining - Stored remaining count.
 * @param limit - Stored limit count.
 * @param resetAt - Stored reset time.
 * @param now - Current time.
 * @returns Current capacity or null when unknown.
 */
function currentWindowCapacity(
	remaining: number | null,
	limit: number | null,
	resetAt: Date | null,
	now: Date,
): number | null {
	if (remaining === null || remaining === undefined) return null;

	if (resetAt && resetAt.getTime() <= now.getTime()) {
		return limit ?? remaining;
	}

	return remaining;
}

/**
 * Keeps an existing future reset or starts a new local fallback window.
 *
 * @param resetAt - Existing reset timestamp.
 * @param now - Current time.
 * @param windowMs - Fallback window duration.
 * @returns Future reset timestamp.
 */
function currentOrNextReset(
	resetAt: Date | null,
	now: Date,
	windowMs: number,
): Date {
	if (resetAt && resetAt.getTime() > now.getTime()) return resetAt;

	return new Date(now.getTime() + windowMs);
}

/**
 * Reads an existing bucket row with a row-level lock.
 *
 * @param bucketKey - Stable bucket key.
 * @returns Locked bucket, or null when not found.
 */
async function lockedBucket(bucketKey: string): Promise<AiRateLimitBucket | null> {
	const row = await AiRateLimitBucket
		.where('bucketKey', bucketKey)
		.toKnex()
		.forUpdate()
		.first();

	return row ? AiRateLimitBucket.fromDb(row) : null;
}

/**
 * Reads active in-flight reservations for a bucket.
 *
 * @param bucketId - Bucket id.
 * @param now - Current time.
 * @returns Active reserved request and token totals.
 */
async function activeReservationTotals(
	bucketId: string,
	now: Date,
): Promise<ActiveReservationTotals> {
	const row = await ActiveRecord.getDb()(AiRateLimitReservation.table)
		.where('bucket_id', bucketId)
		.whereNull('released_at')
		.where('expires_at', '>', now)
		.sum({
			requests: 'reserved_requests',
			tokens: 'reserved_tokens',
		})
		.first() as { requests?: string | number | null; tokens?: string | number | null } | undefined;

	return {
		requests: numberOrZero(row?.requests),
		tokens: numberOrZero(row?.tokens),
	};
}

/**
 * Determines whether a bucket has enough capacity for another request.
 *
 * @param bucket - Current bucket state.
 * @param reservations - Active in-flight reservations.
 * @param estimatedTokens - Estimated tokens for the next call.
 * @param now - Current time.
 * @returns Delay details when the request should be deferred.
 */
function capacityDelay(
	bucket: AiRateLimitBucket,
	reservations: ActiveReservationTotals,
	estimatedTokens: number,
	now: Date,
): CapacityDelay | null {
	const delays: CapacityDelay[] = [];
	const requestsRemaining = effectiveRemaining(bucket.remainingRequests, bucket.limitRequests, bucket.requestsResetAt, now);
	const tokensRemaining = effectiveRemaining(bucket.remainingTokens, bucket.limitTokens, bucket.tokensResetAt, now);
	const projectTokensRemaining = effectiveRemaining(bucket.remainingProjectTokens, bucket.limitProjectTokens, bucket.projectTokensResetAt, now);

	if (requestsRemaining === null && reservations.requests >= 1) {
		delays.push({
			delaySeconds: UNKNOWN_ACTIVE_BUCKET_DELAY_SECONDS,
			resetAt: null,
			reason: 'initial request observation',
		});
	} else if (requestsRemaining !== null && requestsRemaining - reservations.requests < 1) {
		delays.push(delayForReset(bucket.requestsResetAt, now, 'request reset'));
	}

	if (estimatedTokens > 0 && tokensRemaining !== null && tokensRemaining - reservations.tokens < estimatedTokens) {
		delays.push(delayForReset(bucket.tokensResetAt, now, 'token reset'));
	}

	if (estimatedTokens > 0 && projectTokensRemaining !== null && projectTokensRemaining - reservations.tokens < estimatedTokens) {
		delays.push(delayForReset(bucket.projectTokensResetAt, now, 'project token reset'));
	}

	if (delays.length === 0) return null;

	return delays.reduce((latest, candidate) => {
		return candidate.delaySeconds > latest.delaySeconds ? candidate : latest;
	});
}

/**
 * Returns current effective remaining capacity after a reset window elapses.
 *
 * @param remaining - Last observed remaining capacity.
 * @param limit - Last observed maximum capacity.
 * @param resetAt - Last observed reset time.
 * @param now - Current time.
 * @returns Effective remaining capacity, or null when unknown.
 */
function effectiveRemaining(
	remaining: number | null,
	limit: number | null,
	resetAt: Date | null,
	now: Date,
): number | null {
	if (remaining === null || remaining === undefined) return null;

	if (resetAt && resetAt.getTime() <= now.getTime()) {
		return limit ?? remaining;
	}

	return remaining;
}

/**
 * Builds a delay instruction from a reset timestamp.
 *
 * @param resetAt - Reset time, when known.
 * @param now - Current time.
 * @param reason - Delay reason.
 * @returns Capacity delay details.
 */
function delayForReset(
	resetAt: Date | null,
	now: Date,
	reason: string,
): CapacityDelay {
	if (!resetAt) {
		return {
			delaySeconds: UNKNOWN_RESET_DELAY_SECONDS,
			resetAt: null,
			reason,
		};
	}

	return {
		delaySeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
		resetAt,
		reason,
	};
}

/**
 * Creates an inert lease when the limiter is disabled.
 *
 * @param input - Provider request identity.
 * @param bucketKey - Stable bucket key.
 * @returns Empty lease.
 */
function emptyLease(
	input: AIRateLimitAcquireInput,
	bucketKey: string,
): AIRateLimitLease {
	return {
		bucketKey,
		bucket: null,
		reservation: null,
		endpoint: input.endpoint,
		model: input.model,
		operation: input.operation,
	};
}

/**
 * Normalizes an estimated token count for reservation storage.
 *
 * @param value - Unknown estimated token count.
 * @returns Non-negative integer token count.
 */
function normalizeReservedTokens(value: number | null | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.ceil(value)
		: 0;
}

/**
 * Reads all OpenAI rate-limit headers into a plain object.
 *
 * @param headers - HTTP response headers.
 * @returns Present rate-limit headers keyed by lower-case header name.
 */
function rateLimitHeaders(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};

	for (const name of RATE_LIMIT_HEADER_NAMES) {
		const value = headerString(headers, name);

		if (value !== null) {
			result[name] = value;
		}
	}

	return result;
}

/**
 * Reads a trimmed string header.
 *
 * @param headers - HTTP response headers.
 * @param name - Header name.
 * @returns Header value or null.
 */
function headerString(headers: Headers, name: string): string | null {
	const value = headers.get(name);

	return value && value.trim() ? value.trim() : null;
}

/**
 * Reads an integer header value.
 *
 * @param headers - HTTP response headers.
 * @param name - Header name.
 * @returns Integer header value or null.
 */
function integerHeader(headers: Headers, name: string): number | null {
	const value = headerString(headers, name);
	const number = value === null ? NaN : Number(value);

	return Number.isFinite(number) ? Math.trunc(number) : null;
}

/**
 * Parses a reset duration header.
 *
 * @param headers - HTTP response headers.
 * @param name - Header name.
 * @returns Reset duration in milliseconds or null.
 */
function resetHeaderMs(headers: Headers, name: string): number | null {
	return parseRateLimitResetMs(headerString(headers, name));
}

/**
 * Converts a reset duration into an absolute ISO timestamp.
 *
 * @param observedAt - Time the response was observed.
 * @param resetAfterMs - Duration until reset.
 * @returns Reset ISO timestamp or null.
 */
function resetAtIso(observedAt: Date, resetAfterMs: number | null): string | null {
	return resetAfterMs === null
		? null
		: new Date(observedAt.getTime() + resetAfterMs).toISOString();
}

/**
 * Converts nullable aggregate values to numbers.
 *
 * @param value - Aggregate value returned by the database.
 * @returns Number or zero.
 */
function numberOrZero(value: string | number | null | undefined): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const number = Number(value);

		return Number.isFinite(number) ? number : 0;
	}

	return 0;
}
