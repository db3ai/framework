import { AIProviderRetryError } from './AIProviderRetryError';
import { AIProviderStoppedError } from './AIProviderStoppedError';
import type { AIProviderAttempt } from './contracts/Providers';
import { isNetworkFailure } from './AIFailover';
import { ProviderSseObserver } from './ProviderSseObserver';
import { safeProviderRequestId } from './providerFailureDiagnostics';
import { isOpenAIQuotaError, openAIProviderError } from './OpenAIProviderError';

/** Observes provider failures for one request without blocking another request, run or credential. */
export class AIProviderTransport {
	readonly #requestFailures = new WeakMap<AIProviderAttempt, Error>();
	readonly #retryCounts = new WeakMap<AIProviderAttempt, number>();

	/** Normalizes availability failures; ordinary queue retries still spend their configured attempt budget. */
	#failure(attempt: AIProviderAttempt, error: unknown, retryAfterMs?: number): Error | null {
		if (isRequestCancellation(error)) return null;
		const details = openAIProviderError(error);
		if (isOpenAIQuotaError(error)) return new AIProviderStoppedError('quota', details.code, details);
		if (!isTransientProviderFailure(error)) return null;
		const failures = (this.#retryCounts.get(attempt) ?? 0) + 1;
		this.#retryCounts.set(attempt, failures);
		return new AIProviderRetryError(retryAfterMs ?? Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5)), details.code, details);
	}

	/**
	 * Wraps each real HTTP request, including SDK model turns and nested tools.
	 * JSON and SSE diagnostics belong only to this resolved attempt. No database
	 * admission state is read or written, so unrelated calls remain independent.
	 */
	transport(attempt: AIProviderAttempt, fetcher: typeof fetch): typeof fetch {
		return async (url, init) => {
			this.#requestFailures.delete(attempt);
			let response: Response;
			try { response = await fetcher(url, init); }
			catch (error) { throw this.#failure(attempt, error) ?? error; }
			if (!response.headers.get('content-type')?.includes('text/event-stream')) {
				let payload: { error?: unknown; response?: { error?: unknown } } | null;
				try { payload = await response.clone().json() as typeof payload; }
				catch (error) {
					if (!(error instanceof SyntaxError)) throw this.#failure(attempt, error) ?? error;
					payload = null;
				}
				const error = payload?.error ?? payload?.response?.error;
				if (!response.ok || error) {
					const decision = this.#failure(attempt, { error, status: response.status, requestId: response.headers.get('x-request-id') }, providerRetryDelay(response));
					if (decision) this.#requestFailures.set(attempt, decision);
				} else if (payload !== null) this.#retryCounts.delete(attempt);
				return response;
			}
			if (!response.body) return response;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			const transport = this;
			let completed = false;
			/** Classifies complete events without changing the original SDK stream. */
			const observer = new ProviderSseObserver(async data => {
				if (data === '[DONE]') { completed = true; return; }
				let event;
				try { event = JSON.parse(data); } catch { observer.invalidate(); return; }
				if (!event || typeof event !== 'object' || Array.isArray(event)) { observer.invalidate(); return; }
				const error = event.error ?? event.response?.error ?? (event.type === 'error' ? event : null);
				if (error) {
					observer.invalidate();
					if (isOpenAIQuotaError({ error }) || isTransientProviderFailure({ error })) {
						const decision = transport.#failure(attempt, { error, status: response.status, requestId: response.headers.get('x-request-id') }, providerRetryDelay(response));
						if (decision) { transport.#requestFailures.set(attempt, decision); throw decision; }
					}
				} else if (event.type === 'response.completed') {
					if (event.response?.status === 'completed') completed = true;
					else observer.invalidate();
				}
				else if (event.type === 'response.failed' || event.type === 'response.incomplete') observer.invalidate();
			});
			/** Treats undecodable UTF-8 conservatively while still observing subsequent data. */
			const observe = async (text: string): Promise<void> => {
				if (text.includes('\uFFFD')) observer.invalidate();
				await observer.push(text);
			};
			const body = new ReadableStream<Uint8Array>({
				/** Observes bounded complete SSE events while forwarding each original chunk. */
				async pull(controller) {
					try {
						const item = await reader.read();
						if (item.done) {
							await observe(decoder.decode());
							if (response.ok && completed && observer.complete) transport.#retryCounts.delete(attempt);
							controller.close();
							return;
						}
						// Bound temporary decoded fragments independently of upstream chunk size.
						for (let offset = 0; offset < item.value.length; offset += 16_384) await observe(decoder.decode(item.value.subarray(offset, offset + 16_384), { stream: true }));
						controller.enqueue(item.value);
					} catch (error) {
						await reader.cancel().catch(() => {});
						const decision = error instanceof AIProviderRetryError || error instanceof AIProviderStoppedError ? error : transport.#failure(attempt, error);
						if (decision instanceof AIProviderRetryError && !decision.diagnostics.requestId) decision.diagnostics.requestId = safeProviderRequestId(response.headers.get('x-request-id'));
						controller.error(decision ?? error);
					}
				},
				/** Releases only this request's upstream body when the caller stops reading. */
				async cancel(reason) { await reader.cancel(reason); },
			});
			return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
		};
	}

	/** Returns a bounded delay only for a retry of this model request; the SDK owns its retry limit. */
	requestRetryDelay(attempt: AIProviderAttempt, fallback: unknown): number | null {
		const failure = fallback instanceof AIProviderRetryError || fallback instanceof AIProviderStoppedError ? fallback : this.#requestFailures.get(attempt) ?? fallback;
		return failure instanceof AIProviderRetryError ? failure.retryAfterMs : null;
	}

	/** Restores typed HTTP/SSE diagnostics after SDK wrapping; cancellation always takes precedence. */
	requestFailure(attempt: AIProviderAttempt, fallback: unknown): unknown {
		const failure = this.#requestFailures.get(attempt);
		this.#requestFailures.delete(attempt);
		return fallback instanceof AIProviderRetryError || fallback instanceof AIProviderStoppedError || isRequestCancellation(fallback) ? fallback : failure ?? fallback;
	}
}

/** Honors bounded provider retry timing for this request without delaying siblings. */
function providerRetryDelay(response: Response): number | undefined {
	const milliseconds = response.headers.get('retry-after-ms');
	const seconds = response.headers.get('retry-after');
	const delay = milliseconds !== null ? Number(milliseconds) : seconds !== null ? Number(seconds) * 1000 : NaN;
	return Number.isFinite(delay) && delay >= 0 ? Math.min(30_000, Math.max(1, delay)) : undefined;
}

/** Classifies only transport availability failures, leaving ordinary capacity limiting to its owner. */
function isTransientProviderFailure(error: unknown): boolean {
	const details = openAIProviderError(error);
	return isNetworkFailure(error) || details.status === 408 || (details.status !== null && details.status >= 500) || ['server_error', 'service_unavailable', 'overloaded', 'overloaded_error'].includes(details.code ?? '');
}

/** Recognizes explicit caller cancellation through bounded SDK cause wrappers, excluding timeouts. */
function isRequestCancellation(error: unknown, depth = 0): boolean {
	if (!(error instanceof Error) || depth > 4) return false;
	if (error.name === 'AbortError' || error.name === 'APIUserAbortError') return true;
	return isRequestCancellation(error.cause, depth + 1);
}
