import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { describe, expect, it } from 'vitest';
import { App } from '@db3.ai/app/server';
import { AI_PROVIDER } from '@db3.ai/app/ai';
import { AIRateLimitDeferredError, AIRateLimiter, aiRateLimitBucketKey, embeddingsRateLimitEndpoint, imagesRateLimitEndpoint, parseAIRateLimitHeaders, parseRateLimitResetMs, providerResponseMetadata, responsesRateLimitEndpoint } from '@db3.ai/app/ai';
import { AiRateLimitBucket } from '@db3.ai/app/ai';
import { AiRateLimitReservation } from '@db3.ai/app/ai';
import { AiConversation, AiRequest } from '@db3.ai/app/ai';

describe('AIRateLimiter metadata parsing', () => {
	it('parses OpenAI reset duration headers', () => {
		expect(parseRateLimitResetMs('250ms')).toBe(250);
		expect(parseRateLimitResetMs('1s')).toBe(1000);
		expect(parseRateLimitResetMs('1m30s')).toBe(90_000);
		expect(parseRateLimitResetMs('6m0s')).toBe(360_000);
		expect(parseRateLimitResetMs('')).toBeNull();
		expect(parseRateLimitResetMs('later')).toBeNull();
	});

	it('captures provider request id, processing time, and rate-limit snapshots', () => {
		const observedAt = new Date('2026-06-30T10:00:00.000Z');
		const metadata = providerResponseMetadata(new Headers({
			'x-request-id': 'req_123',
			'openai-processing-ms': '37',
			'x-ratelimit-limit-requests': '500',
			'x-ratelimit-remaining-requests': '123',
			'x-ratelimit-reset-requests': '1s',
			'x-ratelimit-limit-tokens': '200000',
			'x-ratelimit-remaining-tokens': '150000',
			'x-ratelimit-reset-tokens': '6m0s',
			'x-ratelimit-limit-project-tokens': '1000000',
			'x-ratelimit-remaining-project-tokens': '990000',
			'x-ratelimit-reset-project-tokens': '250ms',
		}), observedAt);

		expect(metadata.providerRequestId).toBe('req_123');
		expect(metadata.providerProcessingMs).toBe(37);
		expect(metadata.rateLimitSnapshot).toMatchObject({
			observedAt: '2026-06-30T10:00:00.000Z',
			limitRequests: 500,
			remainingRequests: 123,
			requestsResetAfterMs: 1000,
			requestsResetAt: '2026-06-30T10:00:01.000Z',
			limitTokens: 200000,
			remainingTokens: 150000,
			tokensResetAfterMs: 360000,
			tokensResetAt: '2026-06-30T10:06:00.000Z',
			limitProjectTokens: 1000000,
			remainingProjectTokens: 990000,
			projectTokensResetAfterMs: 250,
			projectTokensResetAt: '2026-06-30T10:00:00.250Z',
		});
	});

	it('returns null snapshots when rate-limit headers are absent', () => {
		expect(parseAIRateLimitHeaders(new Headers({
			'x-request-id': 'req_without_limits',
		}))).toBeNull();
	});

	it('keeps Responses, Embeddings, and Images buckets isolated for the same model name', () => {
		expect(aiRateLimitBucketKey(
			AI_PROVIDER.openai,
			responsesRateLimitEndpoint(),
			'gpt-5.4-nano',
		)).toBe('openai:responses:gpt-5.4-nano');
		expect(aiRateLimitBucketKey(
			AI_PROVIDER.openai,
			embeddingsRateLimitEndpoint(),
			'gpt-5.4-nano',
		)).toBe('openai:embeddings:gpt-5.4-nano');
		expect(aiRateLimitBucketKey(
			AI_PROVIDER.openai,
			imagesRateLimitEndpoint(),
			'gpt-5.4-nano',
		)).toBe('openai:images:gpt-5.4-nano');
	});

	it('subtracts active reservations before allowing another worker to start', async () => {
		const database = await createGeneratedTestDatabase('ai_rate_limiter');
		const app = new App({
			db: database.db,
			dbOptions: {
				reportSchemaDiff: false,
			},
		});

		try {
			await app.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiRateLimitReservation);

			const resetAt = new Date(Date.now() + 30_000);
			const bucket = await new AiRateLimitBucket({
				bucketKey: 'openai:responses:gpt-5.4-nano',
				provider: AI_PROVIDER.openai,
				endpoint: responsesRateLimitEndpoint(),
				limitKey: 'gpt-5.4-nano',
				limitRequests: 1,
				remainingRequests: 1,
				requestsResetAt: resetAt,
				limitTokens: 100,
				remainingTokens: 100,
				tokensResetAt: resetAt,
			}).save();
			const reservation = await new AiRateLimitReservation({
				bucket,
				operation: 'responses.create',
				reservedRequests: 1,
				reservedTokens: 10,
				expiresAt: new Date(Date.now() + 60_000),
			}).save();
			const limiter = new AIRateLimiter();

			await expect(limiter.acquire({
				endpoint: responsesRateLimitEndpoint(),
				model: 'gpt-5.4-nano',
				operation: 'responses.create',
				estimatedTokens: 10,
			})).rejects.toMatchObject({
				bucketKey: 'openai:responses:gpt-5.4-nano',
			});
			await expect(limiter.acquire({
				endpoint: responsesRateLimitEndpoint(),
				model: 'gpt-5.4-nano',
				operation: 'responses.create',
				estimatedTokens: 10,
			})).rejects.toBeInstanceOf(AIRateLimitDeferredError);

			reservation.assign({
				releasedAt: new Date(),
			});
			await reservation.save();

			const lease = await limiter.acquire({
				endpoint: responsesRateLimitEndpoint(),
				model: 'gpt-5.4-nano',
				operation: 'responses.create',
				estimatedTokens: 10,
			});

			expect(lease.bucketKey).toBe('openai:responses:gpt-5.4-nano');
			expect(lease.reservation?.id).toEqual(expect.any(String));

			await limiter.release(lease);
		} finally {
			await app.close();
				await database.destroy();
		}
	}, 30000);

	it.each(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-flare-20260901'])('uses conservative image capacity for %s when headers are absent', async model => {
		const database = await createGeneratedTestDatabase('ai_rate_limiter_image_defaults');
		const app = new App({
			db: database.db,
			dbOptions: {
				reportSchemaDiff: false,
			},
		});

		try {
			await app.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiRateLimitReservation);

			const limiter = new AIRateLimiter();

			for (let index = 0; index < 5; index++) {
				const lease = await limiter.acquire({
					endpoint: imagesRateLimitEndpoint(),
					model,
					operation: 'images.generate',
					estimatedTokens: 10,
				});

				await limiter.observe(lease, providerResponseMetadata(new Headers({
					'x-request-id': `req_image_${index}`,
				})));
			}

			const bucket = await AiRateLimitBucket
				.where('bucketKey', `openai:images:${model}`)
				.first();

			expect(bucket).toMatchObject({
				limitRequests: 5,
				remainingRequests: 0,
				limitTokens: model === 'gpt-image-2' ? 100000 : null,
				remainingTokens: model === 'gpt-image-2' ? 99950 : null,
			});
			expect(bucket?.metadata).toMatchObject({
				defaultRateLimit: {
					source: model === 'gpt-image-2' ? 'openai:gpt-image-2:tier-1' : 'local:gpt-image-2.5-flare:conservative',
				},
			});
			await expect(limiter.acquire({
				endpoint: imagesRateLimitEndpoint(),
				model,
				operation: 'images.generate',
				estimatedTokens: 10,
			})).rejects.toMatchObject({
				bucketKey: `openai:images:${model}`,
			});
		} finally {
			await app.close();
				await database.destroy();
		}
	}, 30000);

	it('cleans released and expired reservations after release', async () => {
		const database = await createGeneratedTestDatabase('ai_rate_limiter_cleanup');
		const app = new App({
			db: database.db,
			dbOptions: {
				reportSchemaDiff: false,
			},
		});

		try {
			await app.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiRateLimitReservation);

			const now = Date.now();
			const bucket = await new AiRateLimitBucket({
				bucketKey: 'openai:responses:gpt-5.4-nano',
				provider: AI_PROVIDER.openai,
				endpoint: responsesRateLimitEndpoint(),
				limitKey: 'gpt-5.4-nano',
			}).save();
			const expiredReservation = await new AiRateLimitReservation({
				bucket,
				operation: 'responses.create',
				reservedRequests: 1,
				reservedTokens: 10,
				expiresAt: new Date(now - 1000),
			}).save();
			const activeReservation = await new AiRateLimitReservation({
				bucket,
				operation: 'responses.create',
				reservedRequests: 1,
				reservedTokens: 10,
				expiresAt: new Date(now + 60_000),
			}).save();
			const releasedByLimiter = await new AiRateLimitReservation({
				bucket,
				operation: 'responses.create',
				reservedRequests: 1,
				reservedTokens: 10,
				expiresAt: new Date(now + 60_000),
			}).save();
			const limiter = new AIRateLimiter();

			await limiter.release({
				bucketKey: 'openai:responses:gpt-5.4-nano',
				bucket,
				reservation: releasedByLimiter,
				endpoint: responsesRateLimitEndpoint(),
				model: 'gpt-5.4-nano',
				operation: 'responses.create',
			});

			const rows = await database.db(AiRateLimitReservation.table)
				.select('id');
			const ids = rows.map(row => row.id);

			expect(ids).not.toContain(expiredReservation.id);
			expect(ids).not.toContain(releasedByLimiter.id);
			expect(ids).toContain(activeReservation.id);
		} finally {
			await app.close();
				await database.destroy();
		}
	}, 30000);
});
