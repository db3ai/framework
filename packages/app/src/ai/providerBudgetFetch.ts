import type { AIProviderBudgetHook, AIProviderBudgetInput, AIProviderBudgetReservation, AIProviderBudgetResult } from './contracts/AIProviderBudget.js';

/**
 * Applies app-owned admission before one HTTP call. Admission errors propagate;
 * post-call settlement failures report through the optional safe diagnostic
 * callback while retaining the original provider output or transport error.
 */
export async function providerBudgetFetch(transport: typeof fetch, url: Parameters<typeof fetch>[0], init: RequestInit, input: Omit<AIProviderBudgetInput, 'request'>, reserve: AIProviderBudgetHook, onSettlementError?: (error: unknown) => void): Promise<Response> {
	if (typeof init.body !== 'string') throw new Error('Budgeted AI requests require a JSON body.');
	const request: unknown = JSON.parse(init.body);
	if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Budgeted AI requests require an object body.');
	const body = request as Record<string, unknown>;
	const reservation = await reserve({ ...input, model: typeof body.model === 'string' ? body.model : input.model, endpoint: new URL(url instanceof Request ? url.url : String(url)).pathname, request: body });
	if (!reservation) return transport(url, init);
	const signals = [init.signal, reservation.signal].filter((signal): signal is AbortSignal => Boolean(signal));
	let response: Response;
	const cancelled = signals.find(signal => signal.aborted);
	if (cancelled) {
		await settleProviderBudget(reservation, { status: 499, payload: { error: 'Cancelled before provider dispatch.' }, uncertain: false }, onSettlementError);
		cancelled.throwIfAborted();
	}
	try {
		response = await transport(url, { ...init, ...(reservation.request ? { body: JSON.stringify(reservation.request) } : {}), ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
	} catch (error) {
		await settleProviderBudget(reservation, { status: null, payload: null, uncertain: true }, onSettlementError);
		throw error;
	}
	if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) return observeBudgetStream(response, reservation, onSettlementError);
	const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
	await settleProviderBudget(reservation, { status: response.status, payload, uncertain: !payload }, onSettlementError);
	return response;
}

/** Streams original bytes unchanged while retaining only bounded terminal usage events for settlement. */
function observeBudgetStream(response: Response, reservation: AIProviderBudgetReservation, onSettlementError?: (error: unknown) => void): Response {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let pending = '';
	let payload: Record<string, unknown> | null = null;
	let terminal = false;
	let settled = false;
	/** Finalizes once even when consumer cancellation races the provider's terminal event. */
	const settle = async (uncertain: boolean): Promise<void> => {
		if (settled) return;
		settled = true;
		await settleProviderBudget(reservation, { status: response.status, payload, uncertain }, onSettlementError);
	};
	/** Reads provider data lines without retaining image/output payloads between events. */
	const observe = (chunk: Uint8Array): void => {
		pending += decoder.decode(chunk, { stream: true });
		let boundary: number;
		while ((boundary = pending.indexOf('\n')) >= 0) {
			const line = pending.slice(0, boundary).trim();
			pending = pending.slice(boundary + 1);
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '[DONE]') { terminal = true; continue; }
			try {
				const event = JSON.parse(data) as Record<string, unknown>;
				if (event.response && typeof event.response === 'object') {
					if (['response.completed', 'response.failed', 'response.incomplete'].includes(String(event.type))) { payload = event.response as Record<string, unknown>; terminal = true; }
				} else if (event.usage && typeof event.usage === 'object') payload = event;
			} catch { /* Malformed provider events cannot release an unknown-usage hold. */ }
		}
		if (pending.length > 2_097_152) pending = '';
	};
	const body = new ReadableStream<Uint8Array>({
		/** Preserves backpressure and attempts settlement before EOF without discarding paid output on bookkeeping failure. */
		async pull(controller) {
			try {
				const next = await reader.read();
				if (next.done) { await settle(!terminal); controller.close(); return; }
				observe(next.value);
				controller.enqueue(next.value);
			} catch (error) { await settle(true); controller.error(error); }
		},
		/** Cancellation records observed usage and leaves ambiguous work conservatively reserved. */
		async cancel(reason) { try { await reader.cancel(reason); } finally { await settle(!terminal); } },
	});
	return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Keeps paid provider output and the original transport outcome when post-call
 * accounting fails. Durable holds remain pending; reporting must not turn a
 * bookkeeping failure into a second paid request or discard an observed result.
 */
async function settleProviderBudget(reservation: AIProviderBudgetReservation, result: AIProviderBudgetResult, onError?: (error: unknown) => void): Promise<void> {
	try { await reservation.settle(result); }
	catch (error) {
		try { onError?.(error); }
		catch { /* A diagnostic failure cannot replace a paid provider result. */ }
	}
}
