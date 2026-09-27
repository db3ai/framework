import { describe, expect, it } from 'vitest';
import { isFailoverableFailure, isFailoverableResponse } from '@db3.ai/app/ai';
import { AIRateLimitDeferredError } from '@db3.ai/app/ai';

describe('isFailoverableResponse', () => {
	it.each([408, 409, 429, 500, 502, 503])('treats HTTP %i as failoverable', status => {
		expect(isFailoverableResponse(status, null)).toBe(true);
	});

	it.each([400, 401, 403, 404, 422])('keeps HTTP %i terminal', status => {
		expect(isFailoverableResponse(status, null)).toBe(false);
	});

	it('treats rate-limit, quota, and overload error codes as failoverable regardless of status', () => {
		expect(isFailoverableResponse(400, {
			error: {
				code: 'rate_limit_exceeded',
			},
		})).toBe(true);
		expect(isFailoverableResponse(400, {
			error: {
				code: 'insufficient_quota',
			},
		})).toBe(true);
		expect(isFailoverableResponse(400, {
			error: {
				code: 'overloaded_error',
			},
		})).toBe(true);
	});

	it('keeps request validation errors terminal', () => {
		expect(isFailoverableResponse(400, {
			error: {
				code: 'invalid_request_error',
			},
		})).toBe(false);
	});
});

describe('isFailoverableFailure', () => {
	it('recognizes the timeout raised by AbortSignal.timeout', () => {
		expect(isFailoverableFailure(new DOMException('The operation timed out', 'TimeoutError'))).toBe(true);
	});

	it('fails over local rate-limit deferrals', () => {
		expect(isFailoverableFailure(new AIRateLimitDeferredError(
			60,
			'openai:responses:gpt-test',
			null,
			'Bucket is full.',
		))).toBe(true);
	});

	it('fails over network failures including wrapped undici causes', () => {
		expect(isFailoverableFailure(new TypeError('fetch failed'))).toBe(true);
		expect(isFailoverableFailure(Object.assign(new Error('socket reset'), {
			code: 'ECONNRESET',
		}))).toBe(true);

		const wrapped = new Error('request failed') as Error & { cause?: unknown };

		wrapped.cause = Object.assign(new Error('connect timeout'), {
			code: 'UND_ERR_CONNECT_TIMEOUT',
		});

		expect(isFailoverableFailure(wrapped)).toBe(true);
	});

	it('fails over provider errors with failoverable codes or statuses', () => {
		expect(isFailoverableFailure(Object.assign(new Error('You exceeded your current quota.'), {
			code: 'insufficient_quota',
		}))).toBe(true);
		expect(isFailoverableFailure(Object.assign(new Error('Service unavailable.'), {
			status: 503,
		}))).toBe(true);
	});

	it('keeps generic and request-level errors terminal', () => {
		expect(isFailoverableFailure(new Error('Something else broke.'))).toBe(false);
		expect(isFailoverableFailure(Object.assign(new Error('Bad request.'), {
			status: 400,
		}))).toBe(false);
		expect(isFailoverableFailure('not an error')).toBe(false);
	});
});
