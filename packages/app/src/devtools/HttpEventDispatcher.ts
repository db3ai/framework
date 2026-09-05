import type * as devtools from './contracts/index.js';

const defaultBatchSize = 25;
const defaultFlushIntervalMs = 100;
const defaultRetryAfterMs = 1000;
const defaultRequestTimeoutMs = 1000;
const defaultMaxPendingEvents = 1000;

/**
 * Builds the configured development event ingestion endpoint.
 *
 * @param env - Environment values controlling the devtools service address.
 * @returns Absolute HTTP endpoint for event batches.
 */
export function devtoolsEventsUrl(
	env: devtools.DevtoolsEnvironment = process.env,
): string {
	if (env.PLATFORM_DEVTOOLS_EVENTS_URL) {
		return env.PLATFORM_DEVTOOLS_EVENTS_URL;
	}

	const host = env.PLATFORM_DEVTOOLS_HOST || '127.0.0.1';
	const port = env.PLATFORM_DEVTOOLS_API_PORT || '9998';

	return `http://${host}:${port}/api/events`;
}

/**
 * Creates a bounded, fire-and-forget HTTP dispatcher for framework events.
 *
 * Events are batched off the caller's stack. Failed batches are discarded and
 * subsequent delivery pauses briefly, keeping development instrumentation from
 * affecting application behavior when the event service is unavailable.
 *
 * @param options - Batching, endpoint, timeout, and test-fetch configuration.
 * @returns Callable dispatcher with flush and close lifecycle methods.
 */
export function createHttpEventDispatcher<TEvent extends object>(
	options: devtools.HttpEventDispatcherOptions = {},
): devtools.DevtoolsEventDispatcher<TEvent> {
	const url = options.url ?? devtoolsEventsUrl();
	const batchSize = positiveInteger(options.batchSize, defaultBatchSize);
	const flushIntervalMs = positiveInteger(options.flushIntervalMs, defaultFlushIntervalMs);
	const retryAfterMs = positiveInteger(options.retryAfterMs, defaultRetryAfterMs);
	const requestTimeoutMs = positiveInteger(options.requestTimeoutMs, defaultRequestTimeoutMs);
	const maxPendingEvents = positiveInteger(options.maxPendingEvents, defaultMaxPendingEvents);
	const fetchImpl = options.fetch ?? fetch;
	const queue: TEvent[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<boolean> | null = null;
	let disabledUntil = 0;
	let closed = false;

	/**
	 * Clears the scheduled batch timer.
	 */
	function clearScheduledFlush(): void {
		if (!timer) return;

		clearTimeout(timer);
		timer = null;
	}

	/**
	 * Schedules delivery without keeping an otherwise idle process alive.
	 *
	 * @param delayMs - Delay before the next delivery attempt.
	 */
	function schedule(delayMs = flushIntervalMs): void {
		if (closed || timer || queue.length === 0) return;

		timer = setTimeout(() => {
			timer = null;
			void flushNext();
		}, delayMs);
		timer.unref?.();
	}

	/**
	 * Posts one batch and reports whether it was accepted.
	 *
	 * @param ignoreBackoff - Whether shutdown should bypass the retry pause.
	 * @returns True on accepted delivery and false when delivery was skipped or failed.
	 */
	async function sendNextBatch(ignoreBackoff: boolean): Promise<boolean> {
		if (queue.length === 0) return true;

		const now = Date.now();

		if (!ignoreBackoff && now < disabledUntil) {
			schedule(Math.max(flushIntervalMs, disabledUntil - now));
			return false;
		}

		const batch = queue.splice(0, batchSize);
		const controller = new AbortController();
		const requestTimeout = setTimeout(() => {
			controller.abort();
		}, requestTimeoutMs);
		requestTimeout.unref?.();

		try {
			const response = await fetchImpl(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...options.headers,
				},
				body: JSON.stringify({
					events: batch,
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw new Error(`Devtools event sink returned ${response.status}.`);
			}

			return true;
		} catch (_error) {
			disabledUntil = Date.now() + retryAfterMs;
			return false;
		} finally {
			clearTimeout(requestTimeout);
		}
	}

	/**
	 * Serializes delivery attempts so batches cannot overtake one another.
	 *
	 * @param ignoreBackoff - Whether to bypass a previous failure pause.
	 * @returns True when the attempted batch was accepted.
	 */
	async function flushNext(ignoreBackoff = false): Promise<boolean> {
		clearScheduledFlush();

		while (inFlight) {
			await inFlight;
		}

		if (queue.length === 0) return true;

		inFlight = sendNextBatch(ignoreBackoff);

		try {
			return await inFlight;
		} finally {
			inFlight = null;

			if (!closed && queue.length > 0) {
				schedule();
			}
		}
	}

	const dispatch = ((event: TEvent): void => {
		if (closed) return;

		queue.push(event);

		while (queue.length > maxPendingEvents) {
			queue.shift();
		}

		if (queue.length >= batchSize) {
			void flushNext();
			return;
		}

		schedule();
	}) as devtools.DevtoolsEventDispatcher<TEvent>;

	dispatch.flush = async (): Promise<void> => {
		await flushNext();
	};

	dispatch.close = async (): Promise<void> => {
		if (closed) return;

		closed = true;
		clearScheduledFlush();

		if (inFlight) {
			await inFlight;
		}

		while (queue.length > 0) {
			const sent = await flushNext(true);

			if (!sent) {
				queue.length = 0;
				break;
			}
		}
	};

	return dispatch;
}

/**
 * Returns a positive integer or a safe fallback.
 *
 * @param input - Caller-provided numeric option.
 * @param fallback - Value used for invalid input.
 * @returns Normalized positive integer.
 */
function positiveInteger(
	input: number | undefined,
	fallback: number,
): number {
	if (!Number.isFinite(input) || Number(input) <= 0) return fallback;

	return Math.floor(Number(input));
}
