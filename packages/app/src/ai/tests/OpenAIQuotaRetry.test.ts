import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRequest, openAIQuotaRetryDecision, withOpenAIQuotaRetryMetadata, withoutOpenAIQuotaRetryMetadata } from '@db3.ai/app/ai';

const now = new Date('2026-09-22T12:00:00.000Z');
const quotaError = { code: 'insufficient_quota', message: 'Quota exhausted' };

/**
 * Creates a real, unsaved framework record for the pure retry-policy boundary.
 * @param metadata - Persisted metadata to restore without issuing a DB query.
 * @returns Request with deterministic lifecycle timestamps.
 */
function request(metadata: Record<string, unknown> | null = null): AiRequest {
	return AiRequest.create({ metadata, startedAt: now, createdAt: now });
}

beforeEach(() => {
	vi.stubEnv('OPENAI_QUOTA_RETRY_INITIAL_SECONDS', '900');
	vi.stubEnv('OPENAI_QUOTA_RETRY_MAX_SECONDS', '3600');
	vi.stubEnv('OPENAI_QUOTA_RETRY_WINDOW_SECONDS', '86400');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('OpenAI quota retry policy', () => {
	it('does not defer unrelated provider failures', () => {
		expect(openAIQuotaRetryDecision({ code: 'invalid_api_key' }, request(), now)).toBeNull();
	});

	it('starts a bounded window and doubles later delays up to the configured cap', () => {
		const record = request();
		for (const delaySeconds of [900, 1800, 3600, 3600]) {
			const decision = openAIQuotaRetryDecision(quotaError, record, now)!;
			expect(decision.delaySeconds).toBe(delaySeconds);
			expect(decision.expired).toBe(false);
			expect(decision.retryUntil.toISOString()).toBe('2026-09-23T12:00:00.000Z');
			expect(decision.retryAt.getTime()).toBe(now.getTime() + delaySeconds * 1000);
			record.metadata = withOpenAIQuotaRetryMetadata(record.metadata, decision.metadata);
		}
		expect(record.metadata?.openAIQuotaRetry).toMatchObject({ deferralCount: 4, firstDeferredAt: now.toISOString() });
	});

	it('never schedules beyond the original deadline and expires exactly at it', () => {
		vi.stubEnv('OPENAI_QUOTA_RETRY_WINDOW_SECONDS', '60');
		const record = request();
		const first = openAIQuotaRetryDecision(quotaError, record, now)!;
		expect(first.retryAt).toEqual(new Date('2026-09-22T12:01:00.000Z'));
		record.metadata = withOpenAIQuotaRetryMetadata(null, first.metadata);
		const expired = openAIQuotaRetryDecision(quotaError, record, first.retryUntil)!;
		expect(expired).toMatchObject({ expired: true, delaySeconds: 0, deferralCount: 2 });
		expect(expired.retryUntil).toEqual(first.retryUntil);
	});

	it('falls back safely from malformed metadata and invalid environment values', () => {
		vi.stubEnv('OPENAI_QUOTA_RETRY_INITIAL_SECONDS', '-1');
		vi.stubEnv('OPENAI_QUOTA_RETRY_MAX_SECONDS', 'Infinity');
		vi.stubEnv('OPENAI_QUOTA_RETRY_WINDOW_SECONDS', 'invalid');
		for (const value of [[], null, 'invalid', { code: 'insufficient_quota' }]) {
			const decision = openAIQuotaRetryDecision(quotaError, request({ openAIQuotaRetry: value }), now)!;
			expect(decision).toMatchObject({ deferralCount: 1, delaySeconds: 900, expired: false });
			expect(decision.retryUntil.toISOString()).toBe('2026-09-23T12:00:00.000Z');
		}
	});

	it('uses request creation when execution has not started and ignores invalid persisted dates', () => {
		const record = request();
		record.startedAt = null;
		const initial = openAIQuotaRetryDecision(quotaError, record, now)!;
		record.metadata = withOpenAIQuotaRetryMetadata(null, { ...initial.metadata, firstDeferredAt: 'invalid', retryUntil: 'invalid' });
		expect(openAIQuotaRetryDecision(quotaError, record, now)?.metadata.firstDeferredAt).toBe(now.toISOString());
	});

	it('adds and clears retry state without mutating unrelated audit metadata', () => {
		const metadata = Object.freeze({ trace: 'trace-1' });
		const decision = openAIQuotaRetryDecision(quotaError, request(), now)!;
		const merged = withOpenAIQuotaRetryMetadata(metadata, decision.metadata);
		expect(merged).toEqual({ trace: 'trace-1', openAIQuotaRetry: decision.metadata });
		expect(metadata).toEqual({ trace: 'trace-1' });
		expect(withoutOpenAIQuotaRetryMetadata(merged)).toEqual(metadata);
		expect(merged.openAIQuotaRetry).toEqual(decision.metadata);
		expect(withoutOpenAIQuotaRetryMetadata(null)).toEqual({});
	});
});
