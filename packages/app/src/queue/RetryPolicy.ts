import type * as queue from './contracts';

/**
 * Defaults used to resolve one durable queue retry policy.
 */
export interface QueueRetryBackoffDefaults {
	/** Default delay-growth strategy. */
	strategy: queue.QueueRetryBackoffStrategy;
	/** Default first retry delay in seconds. */
	initialSeconds: number;
	/** Default maximum retry delay in seconds. */
	maxSeconds: number;
	/** Default equal-jitter behavior. */
	jitter: boolean;
}

/**
 * Resolves validated durable backoff values from dispatch overrides and defaults.
 *
 * @param options - Per-dispatch retry backoff overrides.
 * @param defaults - Queue-level retry backoff defaults.
 * @returns Complete retry backoff safe to persist with the job.
 */
export function resolveQueueRetryBackoff(
	options: queue.QueueRetryBackoffOptions | undefined,
	defaults: QueueRetryBackoffDefaults,
): queue.QueueRetryBackoff {
	const initialSeconds = finiteNonNegative(options?.initialSeconds, defaults.initialSeconds);
	const maxSeconds = Math.max(
		initialSeconds,
		finiteNonNegative(options?.maxSeconds, defaults.maxSeconds),
	);

	return {
		strategy: options?.strategy === 'linear' || options?.strategy === 'exponential'
			? options.strategy
			: defaults.strategy,
		initialSeconds,
		maxSeconds,
		jitter: options?.jitter ?? defaults.jitter,
	};
}

/**
 * Calculates the delay for one consumed queue attempt.
 *
 * Equal jitter keeps half of the calculated delay and randomizes the remaining
 * half, preventing large groups of failed jobs from becoming available together.
 *
 * @param backoff - Durable retry backoff attached to the queued job.
 * @param attempt - One-based consumed attempt count.
 * @param random - Random number source used for jitter.
 * @returns Retry delay in whole seconds.
 */
export function queueRetryDelaySeconds(
	backoff: queue.QueueRetryBackoff,
	attempt: number,
	random: () => number = Math.random,
): number {
	const normalizedAttempt = Math.max(1, Math.trunc(attempt));
	const multiplier = backoff.strategy === 'exponential'
		? 2 ** Math.max(0, normalizedAttempt - 1)
		: normalizedAttempt;
	const calculated = Math.min(backoff.maxSeconds, backoff.initialSeconds * multiplier);

	if (!backoff.jitter || calculated <= 0) {
		return Math.ceil(calculated);
	}

	const minimum = calculated / 2;
	const boundedRandom = Math.min(1, Math.max(0, random()));

	return Math.max(1, Math.ceil(minimum + ((calculated - minimum) * boundedRandom)));
}

/**
 * Converts a relative retry window into an absolute Unix timestamp.
 *
 * @param now - Dispatch timestamp in Unix seconds.
 * @param retryUntilSeconds - Requested retry window in seconds.
 * @returns Absolute retry deadline, or undefined when no valid window was supplied.
 */
export function queueRetryUntil(
	now: number,
	retryUntilSeconds: number | undefined,
): number | undefined {
	if (
		typeof retryUntilSeconds !== 'number'
		|| !Number.isFinite(retryUntilSeconds)
		|| retryUntilSeconds <= 0
	) {
		return undefined;
	}

	return now + Math.ceil(retryUntilSeconds);
}

/**
 * Checks whether scheduling another ordinary retry would exceed its deadline.
 *
 * @param retryUntil - Absolute Unix retry deadline stored on the queued job.
 * @param delaySeconds - Calculated delay before the next attempt.
 * @param now - Current Unix timestamp.
 * @returns True when the next retry must become terminal instead.
 */
export function queueRetryDeadlineReached(
	retryUntil: number | undefined,
	delaySeconds: number,
	now: number,
): boolean {
	return typeof retryUntil === 'number'
		&& Number.isFinite(retryUntil)
		&& now + delaySeconds > retryUntil;
}

/**
 * Normalizes an optional numeric value to a finite non-negative number.
 *
 * @param value - Requested numeric value.
 * @param fallback - Value used when the request is invalid.
 * @returns Finite non-negative number.
 */
function finiteNonNegative(value: number | undefined, fallback: number): number {
	const selected = typeof value === 'number' && Number.isFinite(value)
		? value
		: fallback;

	return Math.max(0, selected);
}
