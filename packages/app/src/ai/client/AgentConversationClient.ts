import { parseAgentAdmission, parseAgentSnapshot, parseAgentStop, parseAgentUpdate } from './agentStreamSchemas';
import { applyAgentUpdate } from './applyAgentUpdate';
import type { QueuedAgentRunResponse } from '../contracts/AgentProtocol';
import type * as stream from '../contracts/AgentConversationStream';

/** Browser configuration supplied by the application's authenticated transport owners. */
export interface AgentConversationClientOptions { view: stream.AgentView; http: stream.AgentHttpAdapter; realtime: stream.AgentRealtimeAdapter }

/** Saved-history viewer with best-effort live updates; subscriptions never own execution. */
export class AgentConversationClient {
	#state: stream.AgentClientState;
	#id: string | null = null;
	#generation = 0;
	#abort = new AbortController();
	#unsubscribe: (() => void) | undefined;
	readonly #listeners = new Set<(state: Readonly<stream.AgentClientState>) => void>();
	readonly #notices = new Set<(notice: stream.AgentStreamNotice) => void>();
	readonly #olderPages = new Map<number, stream.AgentConversationSnapshot>();
	#opening: Promise<void> | undefined;
	#refreshing: Promise<void> | undefined;
	#refreshAgain = false;
	#subscribed = false;
	#disposed = false;
	#pinned = false;
	#submission: stream.AgentSendInput | undefined;

	/** Retains adapters without creating a socket or starting a run. */
	constructor(readonly options: AgentConversationClientOptions) {
		this.#state = { snapshot: null, connection: 'idle', synchronizing: false, sending: false, canSend: Boolean(options.http.send), canRetrySend: false, error: null };
	}

	/** Returns detached state; callers cannot mutate the controller's timeline. */
	getState(): Readonly<stream.AgentClientState> {
		const available = Boolean(this.options.http.send) && !this.#disposed && this.#state.connection !== 'denied' && !this.#state.sending;
		return structuredClone({ ...this.#state, canSend: available && !this.#submission, canRetrySend: available && Boolean(this.#submission) });
	}

	/** Observes state, including the current baseline. The returned function removes this listener. */
	onChange(listener: (state: Readonly<stream.AgentClientState>) => void): () => void {
		/** Keeps cleanup scoped to this attachment even when callers reuse a callback. */
		const observer = (state: Readonly<stream.AgentClientState>) => listener(state);
		this.#listeners.add(observer);
		listener(this.getState());
		return () => { this.#listeners.delete(observer); this.#detachIfUnused(); };
	}

	/** Loads saved history before attaching to live output. Socket health does not block this read. */
	async open(conversationId: string): Promise<void> { this.#pinned = true; await this.#open(conversationId); }

	/** Observes one conversation; detaching never stops the server's active or queued turns. */
	stream(conversationId: string, listener: (notice: stream.AgentStreamNotice) => void): () => void {
		const opening = this.#open(conversationId);
		/** An older attachment's cleanup must not remove a later use of the same callback. */
		const observer = (notice: stream.AgentStreamNotice) => listener(notice);
		this.#notices.add(observer);
		if (this.#id === conversationId && this.#state.snapshot) listener({ type: 'snapshot', snapshot: structuredClone(this.#state.snapshot) });
		void opening.catch(() => undefined);
		return () => { this.#notices.delete(observer); this.#detachIfUnused(); };
	}

	/** Admits a message, including while a turn is running. The server owns FIFO queueing. */
	async send(message: string): Promise<QueuedAgentRunResponse> {
		if (!this.options.http.send || this.#disposed || this.#state.connection === 'denied') throw new Error('Conversation is unavailable for sending.');
		if (this.#submission) throw new Error('Retry the previous submission before sending another message.');
		this.#submission = { conversationId: this.#id, message, idempotencyKey: crypto.randomUUID() };
		return this.retrySend();
	}

	/** Reuses the previous submission key after an uncertain admission response. */
	async retrySend(): Promise<QueuedAgentRunResponse> {
		const submission = this.#submission;
		if (!this.options.http.send || !submission) throw new Error('No writable pending submission.');
		if (this.#state.sending || this.#disposed || this.#state.connection === 'denied') throw new Error('Conversation is unavailable for sending.');
		const generation = this.#generation;
		const signal = this.#abort.signal;
		this.#state.sending = true; this.#state.error = null; this.#notify();
		try {
			await this.#opening;
			if (!this.#current(generation)) throw new Error('Conversation selection changed before sending.');
			const response = parseAgentAdmission(await this.options.http.send(submission, signal));
			if (!this.#current(generation)) return response;
			if (submission.conversationId !== null && response.conversationId !== submission.conversationId) throw new Error('Invalid conversation admission response.');
			this.#submission = undefined;
			this.#state.sending = false;
			if (submission.conversationId === null) await this.open(response.conversationId).catch(() => undefined);
			else await this.refresh();
			return response;
		} catch (error) {
			if (this.#current(generation)) {
				const status = (error as { status?: number; statusCode?: number } | null)?.status ?? (error as { statusCode?: number } | null)?.statusCode;
				if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) this.#submission = undefined;
				this.#error(error);
			}
			throw error;
		}
		finally { if (this.#current(generation)) { this.#state.sending = false; this.#notify(); } }
	}

	/** Reloads saved state and every previously opened history page without reconnecting the socket. */
	async refresh(): Promise<void> {
		const generation = this.#generation;
		await this.#opening;
		if (this.#current(generation) && this.#id && this.#state.connection !== 'denied') await this.#refresh();
	}

	/** Stops by conversation ID, including after returning to a running conversation. */
	async stop(): Promise<stream.AgentStopResult> {
		if (!this.options.http.stop || !this.#id || !this.#state.snapshot || this.#disposed) throw new Error('No stoppable conversation is loaded.');
		const generation = this.#generation;
		try {
			const id = this.#id;
			const result = parseAgentStop(await this.options.http.stop({ conversationId: id }, this.#abort.signal));
			if (result.conversationId !== id) throw new Error('Invalid conversation stop response.');
			if (this.#current(generation)) await this.refresh();
			return result;
		} catch (error) { if (this.#current(generation)) this.#error(error); throw error; }
	}

	/** Prepends a saved page in database order. Newer visible items win any overlap. */
	async loadOlder(): Promise<void> {
		const generation = this.#generation;
		await this.#opening;
		await this.#refreshing;
		if (!this.#current(generation)) return;
		const snapshot = this.#state.snapshot;
		if (!snapshot || snapshot.older === null || !this.options.http.history || this.#disposed) return;
		const before = snapshot.older;
		try {
			const page = this.#validate(await this.options.http.history(snapshot.conversationId, before, this.#abort.signal), snapshot.conversationId);
			if (!this.#current(generation) || !this.#state.snapshot) return;
			if (this.#olderPages.has(before)) return;
			this.#olderPages.set(before, page);
			const existing = new Set(this.#state.snapshot.timeline.map(item => item.id));
			this.#state.snapshot.timeline.unshift(...page.timeline.filter(item => !existing.has(item.id)));
			this.#state.snapshot.older = page.older;
			this.#notify();
		} catch (error) { if (this.#current(generation)) this.#error(error); }
	}

	/** Releases reads and subscriptions, leaving the shared socket and server execution alive. */
	dispose(): void { this.#disposed = true; this.#detach(); this.#listeners.clear(); this.#notices.clear(); }

	/** Fences the previous selection before its replacement performs any asynchronous work. */
	async #open(id: string): Promise<void> {
		if (this.#disposed) throw new Error('Conversation client was disposed.');
		if (!id || id.length > 256) throw new Error('Invalid conversation ID.');
		if (id === this.#id && (this.#opening || this.#unsubscribe)) { await this.#opening; return; }
		if (id !== this.#id) this.#notices.clear();
		this.#detach(); this.#id = id;
		const generation = this.#generation;
		this.#state.snapshot = null; this.#state.error = null; this.#state.sending = false;
		this.#state.synchronizing = true; this.#state.connection = 'connecting'; this.#notify();
		const opening = (async () => {
			try {
				const snapshot = this.#validate(await this.options.http.load(id, this.#abort.signal), id);
				if (!this.#current(generation)) return;
				this.#state.snapshot = snapshot; this.#state.synchronizing = false;
				this.#notice({ type: 'snapshot', snapshot }); this.#notify();
				const unsubscribe = this.options.realtime.subscribe(id, {
					/** Refresh after each authorized attachment to close the history-to-socket gap. */
					subscribed: () => { if (this.#current(generation)) { this.#subscribed = true; this.#requestRefresh(); } },
					/** Live data is validated before any display state changes. */
					update: value => { if (this.#current(generation)) this.#receive(value); },
					/** A lost viewer connection never changes the run's state. */
					connection: state => {
						if (!this.#current(generation)) return;
						this.#state.connection = state;
						if (state !== 'connected') this.#subscribed = false;
						this.#notice({ type: 'connection', connection: state }); this.#notify();
					},
					/** Revoked access clears private history immediately. */
					denied: () => { if (this.#current(generation)) this.#deny(); },
				});
				if (this.#current(generation)) this.#unsubscribe = unsubscribe; else unsubscribe();
			} catch (error) { if (this.#current(generation)) { this.#state.synchronizing = false; this.#error(error); } throw error; }
		})();
		this.#opening = opening;
		try { await opening; } finally { if (this.#opening === opening) this.#opening = undefined; }
	}

	/** Drops transient overlap during reads; committed corrections request a fresh baseline. */
	#receive(value: unknown): void {
		try {
			const update = parseAgentUpdate(value);
			if (update.conversationId !== this.#id || update.view !== this.options.view) throw new Error('Stream belongs to another conversation.');
			if (!this.#subscribed) return;
			const durable = ['item.changed', 'history.changed', 'run.state', 'message.completed', 'reasoning.summary.completed', 'tool.success', 'tool.error'].includes(update.event.type);
			if (this.#refreshing) { if (durable) this.#refreshAgain = true; return; }
			const snapshot = this.#state.snapshot;
			if (!snapshot) return;
			if (update.event.type === 'run.state' || update.event.type === 'history.changed') { this.#requestRefresh(); return; }
			if (snapshot.run?.aiRequestId !== update.aiRequestId || snapshot.run.attempt < update.attempt) { this.#requestRefresh(); return; }
			if (snapshot.run.attempt > update.attempt) return;
			if (!durable && !['queued', 'running', 'waiting'].includes(snapshot.run.status)) return;
			applyAgentUpdate(snapshot, update);
			this.#notice({ type: 'event', ...update }); this.#notify();
		} catch (error) { this.#error(error); }
	}

	/** Schedules an ordinary history read; there is no delta recovery protocol or polling timer. */
	#requestRefresh(): void {
		if (this.#refreshing) { this.#refreshAgain = true; return; }
		void this.#refresh().catch(() => undefined);
	}

	/** Refreshes retained page boundaries so old pending tools receive their saved outcomes too. */
	async #refresh(): Promise<void> {
		if (this.#refreshing) return this.#refreshing;
		if (!this.#id || this.#disposed) return;
		const generation = this.#generation;
		const id = this.#id;
		const signal = this.#abort.signal;
		this.#state.synchronizing = true; this.#notify();
		const refreshing = (async () => {
			try {
				do {
					this.#refreshAgain = false;
					const snapshot = this.#validate(await this.options.http.load(id, signal), id);
					if (!this.#current(generation)) return;
					for (const before of this.#olderPages.keys()) {
						const page = this.#validate(await this.options.http.history!(id, before, signal), id);
						if (!this.#current(generation)) return;
						this.#olderPages.set(before, page);
					}
					const pages = [...this.#olderPages.entries()].sort(([left], [right]) => left - right).map(([, page]) => page);
					const timeline = new Map<string, stream.AgentTimelineEntry>();
					for (const page of [...pages, snapshot]) for (const item of page.timeline) timeline.set(item.id, item);
					snapshot.timeline = [...timeline.values()];
					if (pages.length) snapshot.older = pages[0]!.older;
					this.#state.snapshot = snapshot; this.#state.error = null;
					this.#notice({ type: 'snapshot', snapshot }); this.#notify();
				} while (this.#refreshAgain && this.#current(generation));
			} catch (error) { if (this.#current(generation)) this.#error(error); }
			finally { if (this.#current(generation)) { this.#state.synchronizing = false; this.#notify(); } }
		})();
		this.#refreshing = refreshing;
		try { await refreshing; } finally { if (this.#refreshing === refreshing) this.#refreshing = undefined; }
	}

	/** Rejects malformed or cross-conversation HTTP responses before displaying their contents. */
	#validate(value: unknown, id: string): stream.AgentConversationSnapshot {
		const snapshot = parseAgentSnapshot(value);
		if (snapshot.conversationId !== id || snapshot.view !== this.options.view) throw new Error('Invalid conversation baseline.');
		return snapshot;
	}

	/** Cancels only viewer-owned work and discards submissions when changing selection. */
	#detach(): void {
		this.#generation++; this.#abort.abort(); this.#abort = new AbortController();
		this.#unsubscribe?.(); this.#unsubscribe = undefined;
		this.#olderPages.clear(); this.#opening = undefined; this.#refreshing = undefined;
		this.#subscribed = false; this.#refreshAgain = false; this.#submission = undefined;
	}

	/** Releases observational attachments when their final owner leaves. */
	#detachIfUnused(): void { if (!this.#notices.size && !this.#listeners.size && !this.#pinned) this.#detach(); }
	/** Tests selection ownership after asynchronous boundaries. */
	#current(generation: number): boolean { return generation === this.#generation && !this.#disposed; }
	/** Clears protected state and disables the detached view after authorization fails. */
	#deny(): void {
		this.#detach(); this.#state.snapshot = null; this.#state.sending = false;
		this.#state.connection = 'denied'; this.#state.synchronizing = false;
		this.#notice({ type: 'connection', connection: 'denied' }); this.#notify();
	}
	/** Reports transport errors independently of execution; denied reads fail closed. */
	#error(error: unknown): void {
		const status = (error as { status?: number; statusCode?: number } | null)?.status ?? (error as { statusCode?: number } | null)?.statusCode;
		if (status === 401 || status === 403 || status === 404) this.#deny();
		this.#state.error = error instanceof Error ? error.message : 'Unable to load conversation.';
		this.#notice({ type: 'error', message: this.#state.error }); this.#notify();
	}
	/** Isolates rendering failures from transport and execution state. */
	#notify(): void { for (const listener of this.#listeners) { try { listener(this.getState()); } catch { /* Rendering cannot own execution. */ } } }
	/** Delivers detached observations without allowing observers to mutate the controller. */
	#notice(notice: stream.AgentStreamNotice): void { for (const listener of this.#notices) { try { listener(structuredClone(notice)); } catch { /* Other attachments must still receive updates. */ } } }
}
