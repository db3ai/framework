import { AIProviderTimeoutError } from './AIProviderTimeoutError';

/**
 * Fails a provider request only when it stops making progress.
 *
 * One timer runs while waiting on the provider: from the request until headers, and
 * during each body read. A stream that keeps delivering data can run for any length of
 * time, and a slow reader is not reported as a stuck provider.
 *
 * @param transport - Underlying fetch implementation.
 * @param timeoutMs - Longest time to wait for the provider to send anything.
 * @param onTimeout - Reports the limit being reached, before the request fails.
 * @returns Fetch implementation that enforces the limit.
 */
export function withProviderInactivityTimeout(transport: typeof fetch, timeoutMs: number, onTimeout?: (error: AIProviderTimeoutError) => void): typeof fetch {
	return async (url, init) => {
		const controller = new AbortController();
		const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
		/** Waits on the provider, aborting the request if nothing arrives in time. */
		const waitFor = async <T>(work: () => Promise<T>): Promise<T> => {
			const timer = setTimeout(() => {
				const error = new AIProviderTimeoutError(timeoutMs);
				onTimeout?.(error);
				controller.abort(error);
			}, timeoutMs);
			try { return await untilAborted(work(), controller.signal); }
			finally { clearTimeout(timer); }
		};

		const response = await waitFor(() => transport(url, { ...init, signal }));
		if (!response.body) return response;

		const reader = response.body.getReader();
		const body = new ReadableStream<Uint8Array>({
			/** Forwards one chunk, limiting only the wait for the provider. */
			async pull(stream) {
				try {
					const item = await waitFor(() => reader.read());
					if (item.done) stream.close(); else stream.enqueue(item.value);
				} catch (error) {
					await reader.cancel(error).catch(() => {});
					stream.error(error);
				}
			},
			/** Releases the provider body when the caller stops reading. */
			async cancel(reason) { await reader.cancel(reason); },
		});
		return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
	};
}

/**
 * Settles with `work`, or rejects as soon as `signal` aborts, even if `work` ignores the signal.
 *
 * The listener is removed when `work` settles. A race against one request-wide promise
 * would keep every chunk read so far alive for as long as the stream stays open.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		/** Rejects with the timeout that aborted the request. */
		const onAbort = (): void => reject(signal.reason);
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}
