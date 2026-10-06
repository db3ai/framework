import { ulid } from '@db3.ai/pure/ulid';
import { createHash, randomUUID } from 'node:crypto';
import { ActiveRecord } from '@db3.ai/app/db';
import { QueueTerminalError, QueueRetryLaterError } from '@db3.ai/app/queue';
import { app } from '../server/appContext';
import { AiRateLimitBucket } from './AiRateLimitBucket';
import type { AIProviderAttempt } from './contracts/Providers';
import { isNetworkFailure } from './AIFailover';
import { ProviderSseObserver } from './ProviderSseObserver';
import { isOpenAIQuotaError, openAIProviderError } from './OpenAIProviderError';

/** Account outage policy, independent of model capacity and application billing. */
export interface AIProviderAdmissionOptions {
	/** First transient cooldown; defaults to 30 seconds. */
	initialSeconds?: number;
	/** Maximum transient cooldown; defaults to five minutes. */
	maxSeconds?: number;
	/** Continuous failure episode deadline; defaults to fifteen minutes. */
	failureWindowSeconds?: number;
	/** Recovery ownership lifetime; must exceed the request timeout. Defaults to 90 seconds. */
	recoveryLeaseSeconds?: number;
}

/** Durable episode metadata stored only on the account's dedicated bucket row. */
interface AdmissionState {
	generation: string;
	failures: number;
	deadline: number;
	retryAt: number;
	stopped: boolean;
	reason: 'quota' | 'outage';
	probe: string | null;
	probeUntil: number;
}

/** Token fences a recovery completion against newer failures and expired leases. */
export interface AIProviderAdmissionLease {
	bucketKey: string;
	generation: string | null;
	probe: string | null;
}

/** Queue backpressure that releases the job's reservation without spending a try. */
export class AIProviderDeferredError extends QueueRetryLaterError {
	/** True only for the request that observed the provider failure. */
	providerStarted = false;
	/** Recognized rejection diagnostics for the observing request; absent for blocked work. */
	readonly providerCode: string | null;
	readonly diagnostics: { status: number | null; requestId: string | null };
	/** Creates an account cooldown without retaining provider payloads. */
	constructor(readonly retryAt: Date, readonly retryUntil: Date, providerCode: string | null = null, diagnostics: { status?: number | null; requestId?: string | null } = {}) {
		super(Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000)), 'AI provider temporarily unavailable; waiting for controlled recovery.');
		this.providerCode = safeProviderCode(providerCode);
		this.diagnostics = { status: safeProviderStatus(diagnostics.status), requestId: safeProviderRequestId(diagnostics.requestId) };
		this.name = 'AIProviderDeferredError';
	}
}

/** Terminal admission failure; exhausted accounts require explicit operator recovery. */
export class AIProviderStoppedError extends QueueTerminalError {
	/** Stable admission code; original provider code stays separate. */
	readonly code = 'ai_provider_stopped';
	/** Recognized original rejection code; never an arbitrary provider message. */
	readonly providerCode: string | null;
	/** Actual rejection status and provider support identifier; absent for blocked work. */
	readonly status: number | null;
	readonly requestId: string | null;
	/** Distinguishes account admission expiry from an individual run stopped to prevent replay. */
	readonly stopStage: 'quota' | 'deadline' | 'stream-output';
	/** True only for the request that observed the provider failure. */
	providerStarted = false;
	/** Creates a terminal failure without provider credentials or raw error messages. */
	constructor(readonly reason: 'quota' | 'outage', providerCode: string | null = null, diagnostics: { status?: number | null; requestId?: string | null; stopStage?: 'stream-output' } = {}) {
		super(diagnostics.stopStage === 'stream-output' ? 'AI provider interrupted after streamed output; run stopped to prevent unsafe replay.' : reason === 'quota' ? 'AI provider credits exhausted; work stopped until operator recovery.' : 'AI provider failure deadline reached; work stopped until operator recovery.');
		this.providerCode = safeProviderCode(providerCode);
		this.status = safeProviderStatus(diagnostics.status);
		this.requestId = safeProviderRequestId(diagnostics.requestId);
		this.stopStage = diagnostics.stopStage ?? (reason === 'quota' ? 'quota' : 'deadline');
		this.name = 'AIProviderStoppedError';
	}
}

/**
 * Coordinates account-wide outages using existing SQL bucket metadata.
 * Closed accounts admit normally. Failed accounts admit one leased real request
 * after cooldown. Exhaustion and expired episodes remain stopped across restarts;
 * reset() is an explicit operator action and never executes or replays work.
 */
export class AIProviderAdmission {
	/** Carries typed HTTP/SSE failures through SDKs that discard provider error codes. */
	readonly #requestFailures = new WeakMap<AIProviderAttempt, Error>();
	readonly #options: Required<AIProviderAdmissionOptions>;
	/** Validates bounded outage policy; invalid values fail at boot. */
	constructor(options: AIProviderAdmissionOptions = {}) {
		this.#options = { initialSeconds: 30, maxSeconds: 300, failureWindowSeconds: 900, recoveryLeaseSeconds: 90, ...options };
		if (Object.values(this.#options).some(value => !Number.isFinite(value) || value <= 0) || this.#options.initialSeconds > this.#options.maxSeconds) throw new Error('Invalid AI provider admission policy.');
	}

	/**
	 * Admits normal work or exclusively leases a recovery request under a SQL lock.
	 * Account identity includes provider, origin and a one-way credential digest,
	 * never endpoint/model or website. Other accounts remain independent.
	 */
	async acquire(attempt: AIProviderAttempt, now = Date.now()): Promise<AIProviderAdmissionLease> {
		const bucketKey = accountKey(attempt);
		return this.#locked(attempt, async bucket => {
			const state = bucket.metadata?.admission as AdmissionState | undefined;
			if (!state) return { bucketKey, generation: null, probe: null };
			if (state.stopped || now >= state.deadline) throw new AIProviderStoppedError(state.reason);
			const retryAt = Math.max(state.retryAt, state.probe ? state.probeUntil : 0);
			if (now < retryAt) throw new AIProviderDeferredError(new Date(Math.min(retryAt, state.deadline)), new Date(state.deadline));
			state.probe = randomUUID();
			state.probeUntil = now + this.#options.recoveryLeaseSeconds * 1000;
			bucket.metadata = { admission: state };
			await bucket.save();
			return { bucketKey, generation: state.generation, probe: state.probe };
		});
	}

	/**
	 * Records an actual provider failure before releasing external admission.
	 * Ordinary 429 capacity never trips an account outage. Late failures extend
	 * the same deadline; they cannot reopen quota or start a fresh episode.
	 */
	async failure(attempt: AIProviderAttempt, lease: AIProviderAdmissionLease, error: unknown, now = Date.now()): Promise<Error | null> {
		// A caller stopping its request says nothing about provider availability.
		// Leave an existing recovery lease bounded; cancellation is not recovery proof.
		if (isRequestCancellation(error)) return null;
		const details = openAIProviderError(error);
		const quota = isOpenAIQuotaError(error);
		const transient = !quota && isTransientProviderFailure(error);
		if (!quota && !transient) {
			await this.success(attempt, lease, now);
			return null;
		}
		return this.#locked(attempt, async bucket => {
			const previous = bucket.metadata?.admission as AdmissionState | undefined;
			// A stale recovery completion cannot overwrite a newer episode/probe.
			if (!quota && lease.probe && previous && (previous.generation !== lease.generation || previous.probe !== lease.probe)) return previous.stopped || now >= previous.deadline ? new AIProviderStoppedError(previous.reason) : new AIProviderDeferredError(new Date(Math.min(Math.max(previous.retryAt, previous.probeUntil), previous.deadline)), new Date(previous.deadline));
			const failures = (previous?.failures ?? 0) + 1;
			const deadline = previous?.deadline ?? now + this.#options.failureWindowSeconds * 1000;
			const state: AdmissionState = {
				generation: randomUUID(), failures, deadline,
				retryAt: Math.min(deadline, now + Math.min(this.#options.maxSeconds, this.#options.initialSeconds * 2 ** Math.min(failures - 1, 20)) * 1000),
				stopped: quota || Boolean(previous?.stopped) || now >= deadline,
				reason: quota || previous?.reason === 'quota' ? 'quota' : 'outage', probe: null, probeUntil: 0,
			};
			bucket.metadata = { admission: state };
			await bucket.save();
			const decision = state.stopped ? new AIProviderStoppedError(state.reason, details.code, { status: details.status, requestId: details.requestId }) : new AIProviderDeferredError(new Date(state.retryAt), new Date(deadline), details.code, { status: details.status, requestId: details.requestId });
			decision.providerStarted = true;
			return decision;
		});
	}

	/** Clears an episode only for its still-owned recovery request before deadline. */
	async success(attempt: AIProviderAttempt, lease: AIProviderAdmissionLease, now = Date.now()): Promise<void> {
		if (!lease.probe) return;
		try {
			await this.#locked(attempt, async bucket => {
				const state = bucket.metadata?.admission as AdmissionState | undefined;
				if (!state || state.stopped || state.generation !== lease.generation || state.probe !== lease.probe || now >= Math.min(state.deadline, state.probeUntil)) return;
				bucket.metadata = null;
				await bucket.save();
			});
		} catch {
			// A successful paid response must survive recovery bookkeeping failure.
			try { app().log.warn({ stage: 'provider-admission:recovery' }, 'AI recovery bookkeeping failed; recovery lease remains bounded.'); } catch { /* Logging cannot replace a paid result. */ }
		}
	}

	/** Explicit operator reset after repair; does not dispatch, probe or replay jobs. */
	async reset(attempt: AIProviderAttempt): Promise<void> {
		await this.#locked(attempt, async bucket => { bucket.metadata = null; await bucket.save(); });
	}

	/**
	 * Wraps each real HTTP request, including SDK model turns and nested tools.
	 * JSON failures and streaming failures trip the same account state. Recovery
	 * is cleared only after body consumption, so header arrival is not recovery.
	 */
	transport(attempt: AIProviderAttempt, fetcher: typeof fetch): typeof fetch {
		return async (url, init) => {
			this.#requestFailures.delete(attempt);
			const lease = await this.acquire(attempt);
			let response: Response;
			try { response = await fetcher(url, init); }
			catch (error) { throw await this.failure(attempt, lease, error) ?? error; }
			if (!response.headers.get('content-type')?.includes('text/event-stream')) {
				let payload: { error?: unknown; response?: { error?: unknown } } | null;
				try { payload = await response.clone().json() as typeof payload; }
				catch (error) {
					if (!(error instanceof SyntaxError)) throw await this.failure(attempt, lease, error) ?? error;
					payload = null;
				}
				const error = payload?.error ?? payload?.response?.error;
				if (!response.ok || error) {
					const decision = await this.failure(attempt, lease, { error, status: response.status, requestId: response.headers.get('x-request-id') });
					if (decision) this.#requestFailures.set(attempt, decision);
				} else if (payload !== null) await this.success(attempt, lease);
				return response;
			}
			if (!response.body) return response;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			const guard = this;
			let completed = false;
			/** Classifies completed events without changing the SDK stream or clearing failed probes. */
			const observer = new ProviderSseObserver(async data => {
				if (data === '[DONE]') { completed = true; return; }
				let event;
				try { event = JSON.parse(data); } catch { observer.invalidate(); return; }
				if (!event || typeof event !== 'object' || Array.isArray(event)) { observer.invalidate(); return; }
				const error = event.error ?? event.response?.error ?? (event.type === 'error' ? event : null);
				if (error) {
					observer.invalidate();
					if (isOpenAIQuotaError({ error }) || isTransientProviderFailure({ error })) {
						const decision = await guard.failure(attempt, lease, { error, status: response.status, requestId: response.headers.get('x-request-id') });
						if (decision) guard.#requestFailures.set(attempt, decision);
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
							if (response.ok && completed && observer.complete) await guard.success(attempt, lease);
							controller.close();
							return;
						}
						// Bound temporary decoded fragments independently of upstream chunk size.
						for (let offset = 0; offset < item.value.length; offset += 16_384) await observe(decoder.decode(item.value.subarray(offset, offset + 16_384), { stream: true }));
						controller.enqueue(item.value);
					} catch (error) {
						await reader.cancel().catch(() => {});
						const decision = error instanceof AIProviderDeferredError || error instanceof AIProviderStoppedError ? error : await guard.failure(attempt, lease, error);
						if (decision instanceof AIProviderDeferredError && !decision.diagnostics.requestId) decision.diagnostics.requestId = safeProviderRequestId(response.headers.get('x-request-id'));
						controller.error(decision ?? error);
					}
				},
				/** Cancellation retains the bounded recovery lease rather than asserting success. */
				async cancel(reason) { await reader.cancel(reason); },
			});
			return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
		};
	}

	/**
	 * Returns the shared cooldown for a safe SDK retry of the current model request.
	 * The SDK vetoes emitted output and cancellation before consulting its policy.
	 * Retains the typed failure until transport actually starts the next attempt,
	 * because its stateful-request veto runs after policy evaluation. Every new
	 * attempt reacquires admission; terminal and cancellation decisions take priority.
	 */
	requestRetryDelay(attempt: AIProviderAttempt, fallback: unknown, now = Date.now()): number | null {
		const failure = fallback instanceof AIProviderDeferredError || fallback instanceof AIProviderStoppedError ? fallback : this.#requestFailures.get(attempt) ?? fallback;
		if (!(failure instanceof AIProviderDeferredError) || now >= failure.retryUntil.getTime()) return null;
		return Math.max(1, Math.min(failure.retryAt.getTime(), failure.retryUntil.getTime()) - now);
	}

	/** Restores a typed HTTP/SSE admission failure after the SDK consumes its original event. */
	requestFailure(attempt: AIProviderAttempt, fallback: unknown): unknown {
		const failure = this.#requestFailures.get(attempt);
		this.#requestFailures.delete(attempt);
		return fallback instanceof AIProviderDeferredError || fallback instanceof AIProviderStoppedError || isRequestCancellation(fallback) ? fallback : failure ?? fallback;
	}

	/** Creates and locks the dedicated account row in an autocommit transaction. */
	async #locked<T>(attempt: AIProviderAttempt, operation: (bucket: AiRateLimitBucket) => Promise<T>): Promise<T> {
		const bucketKey = accountKey(attempt);
		const db = app().db.knex;
		// Use the service connection: caller transactions must not hide the trip from workers.
		await db(AiRateLimitBucket.table).insert({ id: ulid(), bucket_key: bucketKey, provider: attempt.provider, endpoint: 'responses', limit_key: 'account-admission', created_at: new Date(), updated_at: new Date() }).onConflict('bucket_key').ignore();
		return db.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const bucket = await AiRateLimitBucket.where('bucketKey', bucketKey).toKnex().forUpdate().first();
			if (!bucket) throw new Error('AI provider admission row unavailable.');
			const model = await AiRateLimitBucket.findOrFail(bucket.id);
			return operation(model);
		}));
	}
}

/** Opaque credential identity; never persisted or logged in reversible form. */
function accountKey(attempt: AIProviderAttempt): string {
	const digest = createHash('sha256').update(`${attempt.provider}\n${new URL(attempt.baseUrl).href.replace(/\/+$/g, '')}\n${attempt.apiKey}`).digest('hex');
	return `${attempt.provider}:account:${digest}`;
}

/** Classifies only transport availability failures, without clearing recovery state. */
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

/** Retains only recognized rejection codes, never arbitrary provider-supplied text. */
function safeProviderCode(value: string | null): string | null {
	return value !== null && ['insufficient_quota', 'billing_hard_limit_reached', 'credit_balance_exhausted', 'server_error', 'service_unavailable', 'overloaded', 'overloaded_error', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(value) ? value : null;
}

/** Reports rejection HTTP status; a successful SSE handshake is not a rejection status. */
function safeProviderStatus(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

/** Bounds opaque support identifiers and rejects whitespace, headers and arbitrary messages. */
function safeProviderRequestId(value: unknown): string | null {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}
