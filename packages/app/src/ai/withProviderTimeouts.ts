import { AIProviderTimeoutError, type AIProviderTimeoutKind } from './AIProviderTimeoutError';

/** Time limits for one provider HTTP request. */
export interface ProviderTimeouts {
	/** Maximum wait for response headers, covering connection and first byte. */
	responseStartMs: number;
	/** Maximum silence between body chunks; each chunk restarts it. */
	streamIdleMs: number;
	/** Optional ceiling on the whole request, however active. */
	totalMs?: number | null;
	/** Reports a limit being reached, before the request fails. */
	onTimeout?: (error: AIProviderTimeoutError) => void;
}

/**
 * Applies separate response-start, stream-idle and overall limits to a fetch transport.
 *
 * A stream that keeps delivering data is never stopped unless `totalMs` is set.
 * The idle limit runs only while waiting on the provider, so a slow reader is not
 * reported as a provider stall. Each failure is an {@link AIProviderTimeoutError}.
 *
 * @param transport - Underlying fetch implementation.
 * @param timeouts - Limits for each request.
 * @returns Fetch implementation that enforces the limits.
 */
export function withProviderTimeouts(transport: typeof fetch, timeouts: ProviderTimeouts): typeof fetch {
	return async (url, init) => {
		const controller = new AbortController();
		let expire!: (error: AIProviderTimeoutError) => void;
		const expired = new Promise<never>((_, reject) => { expire = reject; });
		expired.catch(() => {});
		let failed = false;
		/** Fails the request once, aborting the connection and any pending read. */
		const fail = (kind: AIProviderTimeoutKind, timeoutMs: number): void => {
			if (failed) return;
			failed = true;
			const error = new AIProviderTimeoutError(kind, timeoutMs);
			timeouts.onTimeout?.(error);
			expire(error);
			controller.abort(error);
		};
		const totalTimer = timeouts.totalMs ? setTimeout(fail, timeouts.totalMs, 'total', timeouts.totalMs) : null;
		const startTimer = setTimeout(fail, timeouts.responseStartMs, 'response_start', timeouts.responseStartMs);
		/** Stops the limits that outlive the response headers. */
		const finish = (): void => { if (totalTimer) clearTimeout(totalTimer); };
		const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;

		let response: Response;
		try { response = await Promise.race([transport(url, { ...init, signal }), expired]); }
		catch (error) { finish(); throw error; }
		finally { clearTimeout(startTimer); }
		if (!response.body) { finish(); return response; }

		const reader = response.body.getReader();
		const body = new ReadableStream<Uint8Array>({
			/** Forwards one chunk, limiting only the wait for the provider. */
			async pull(stream) {
				const idleTimer = setTimeout(fail, timeouts.streamIdleMs, 'stream_idle', timeouts.streamIdleMs);
				try {
					const item = await Promise.race([reader.read(), expired]);
					if (item.done) { finish(); stream.close(); } else stream.enqueue(item.value);
				} catch (error) {
					finish();
					await reader.cancel(error).catch(() => {});
					stream.error(error);
				} finally { clearTimeout(idleTimer); }
			},
			/** Releases the provider body when the caller stops reading. */
			async cancel(reason) { finish(); await reader.cancel(reason); },
		});
		return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
	};
}
