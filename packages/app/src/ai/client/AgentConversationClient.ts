import { agentSnapshotSchema, agentTimelineEntrySchema, agentUpdateSchema } from './agentStreamSchemas';
import { applyAgentUpdate } from './applyAgentUpdate';
import type { QueuedAgentRunResponse } from '../contracts/AgentProtocol';
import type * as stream from '../contracts/AgentConversationStream';

/** Browser configuration supplied once by the application's authenticated transport owners. */
export interface AgentConversationClientOptions { view: stream.AgentView; http: stream.AgentHttpAdapter; realtime: stream.AgentRealtimeAdapter }

/** HTTP-first conversation viewer with ordered socket recovery and no background polling. */
export class AgentConversationClient {
	#state: stream.AgentClientState;
	#id: string | null = null;
	#generation = 0;
	#abort = new AbortController();
	#unsubscribe: (() => void) | undefined;
	readonly #listeners = new Set<(state: Readonly<stream.AgentClientState>) => void>();
	readonly #notices = new Set<(notice: stream.AgentStreamNotice) => void>();
	#buffer: stream.AgentUpdateResult[] = [];
	#bufferBytes = 0;
	#recovering: Promise<void> | undefined;
	#opening: Promise<void> | undefined;
	#subscribed = false;
	#resetRequired = false;
	#paused = false;
	#disposed = false;
	#pinned = false;
	#submission: stream.AgentSendInput | undefined;
	readonly #versions = new Map<string, number>();

	/** Retains adapters without creating a socket or starting a run. */
	constructor(readonly options: AgentConversationClientOptions) {
		this.#state = { snapshot: null, connection: 'idle', synchronizing: false, sending: false, canSend: Boolean(options.http.send), error: null };
	}

	/** Returns a detached view so consumers cannot mutate cursor or timeline ownership. */
	getState(): Readonly<stream.AgentClientState> { return structuredClone(this.#state); }

	/** Observes normalized state, including the current baseline; returns listener cleanup. */
	onChange(listener: (state: Readonly<stream.AgentClientState>) => void): () => void {
		this.#listeners.add(listener);
		listener(this.getState());
		return () => this.#listeners.delete(listener);
	}

	/** Loads HTTP state before subscribing; resolves without waiting for socket health. */
	async open(conversationId: string): Promise<void> { this.#pinned = true; await this.#open(conversationId); }

	/** Attaches callbacks to an existing conversation; cleanup never cancels server execution. */
	stream(conversationId: string, listener: (notice: stream.AgentStreamNotice) => void): () => void {
		if (this.#id && this.#id !== conversationId) this.#notices.clear();
		const opening = this.#open(conversationId);
		this.#notices.add(listener);
		if (this.#id === conversationId && this.#state.snapshot) listener({ type: 'snapshot', snapshot: structuredClone(this.#state.snapshot) });
		void opening.catch(() => undefined);
		return () => { this.#notices.delete(listener); if (!this.#notices.size && !this.#listeners.size && !this.#pinned) this.#detach(); };
	}

	/** Admits one intentional message with a UUID retained across uncertain HTTP outcomes. */
	async send(message: string): Promise<QueuedAgentRunResponse> {
		if (this.#submission) throw new Error('Resolve the previous submission before sending another message.');
		this.#submission = { conversationId: this.#id, message, idempotencyKey: crypto.randomUUID() };
		return this.retrySend();
	}

	/** Retries admission with exactly the previous key and body, without duplicating the turn. */
	async retrySend(): Promise<QueuedAgentRunResponse> {
		if (!this.options.http.send || !this.#submission) throw new Error('No writable pending submission.');
		if (this.#state.sending || this.#disposed) throw new Error('Conversation is unavailable for sending.');
		this.#state.sending = true; this.#state.error = null; this.#notify();
		try {
			const run = await this.options.http.send(this.#submission, this.#abort.signal);
			this.#submission = undefined;
			void this.open(run.conversationId).catch(() => undefined);
			return run;
		} catch (error) { this.#error(error); throw error; }
		finally { this.#state.sending = false; this.#notify(); }
	}

	/** Explicitly reloads saved state; failed socket health never prevents this read. */
	async refresh(): Promise<void> { if (this.#id) await this.#open(this.#id, true); }

	/** Adds older HTTP history after reconciling its boundary; current items always win. */
	async loadOlder(): Promise<void> {
		const snapshot = this.#state.snapshot;
		if (!snapshot || snapshot.older === null || !this.options.http.history) return;
		const generation = this.#generation;
		try {
			const page = agentSnapshotSchema.parse(await this.options.http.history(snapshot.cursor.conversationId, snapshot.older, this.#abort.signal));
			this.#checkCursor(page.cursor);
			await this.#recover();
			if (!this.#current(generation) || !this.#state.snapshot) return;
			if (this.#state.snapshot.cursor.sequence < page.cursor.sequence) throw new Error('History changed while loading. Refresh the conversation.');
			const existing = new Set(this.#state.snapshot.timeline.map(item => item.id));
			this.#state.snapshot.timeline.unshift(...page.timeline.filter(item => !existing.has(item.id)));
			this.#state.snapshot.older = page.older;
			this.#notify();
		} catch (error) { if (this.#current(generation)) this.#error(error); }
	}

	/** Loads a large item on demand without permitting stale chunks to replace newer live output. */
	async loadItem(reference: stream.AgentItemReference): Promise<void> {
		if (!this.#id || !this.options.http.item) throw new Error('Item loading is unavailable.');
		const generation = this.#generation;
		const version = this.#versions.get(reference.id);
		try {
			let content = ''; let offset = 0; let revision: string | undefined;
			for (;;) {
				const page = await this.options.http.item(this.#id, reference.key, offset, revision, this.#abort.signal);
				if (!this.#current(generation)) return;
				if (page.itemId !== reference.key || typeof page.content !== 'string' || typeof page.revision !== 'string' || revision && page.revision !== revision || page.nextOffset !== null && page.nextOffset !== offset + page.content.length) throw new Error('Invalid conversation item page.');
				content += page.content; revision = page.revision;
				if (content.length > 8_000_000) throw new Error('This item is too large to display.');
				if (page.nextOffset === null) break;
				if (page.nextOffset <= offset) throw new Error('Invalid conversation item offset.');
				offset = page.nextOffset;
			}
			const item = agentTimelineEntrySchema.parse(JSON.parse(content));
			if (item.id !== reference.id || item.kind === 'reference') throw new Error('Invalid conversation item identity.');
			if (version !== this.#versions.get(reference.id)) throw new Error('This item changed while loading. Open it again.');
			const index = this.#state.snapshot?.timeline.findIndex(entry => entry.id === reference.id) ?? -1;
			if (index >= 0) { this.#state.snapshot!.timeline[index] = item; this.#notify(); }
		} catch (error) { if (this.#current(generation)) this.#error(error); }
	}

	/** Aborts feature reads and subscriptions; the shared socket and server run remain alive. */
	dispose(): void { this.#disposed = true; this.#detach(); this.#listeners.clear(); this.#notices.clear(); }

	/** Fences all work from the previous selection before beginning an HTTP-first attachment. */
	async #open(id: string, force = false): Promise<void> {
		if (this.#disposed) throw new Error('Conversation client was disposed.');
		if (!force && id === this.#id && (this.#opening || this.#state.snapshot && this.#unsubscribe)) { await this.#opening; return; }
		if (this.#id && this.#id !== id) this.#notices.clear();
		this.#detach(); this.#id = id;
		const generation = this.#generation;
		this.#state.snapshot = null; this.#state.error = null; this.#state.synchronizing = true;
		this.#state.connection = 'connecting'; this.#notify();
		const opening = (async () => {
			try {
				await this.#baseline(generation);
				if (!this.#current(generation)) return;
				this.#state.synchronizing = false; this.#notify();
				const unsubscribe = this.options.realtime.subscribe(id, {
					/** Subscription acknowledgement closes the HTTP-to-socket race. */
					subscribed: () => { if (!this.#current(generation)) return; this.#subscribed = true; this.#paused = false; void this.#recover(); },
					/** Validates every live frame before buffering or applying it. */
					update: value => { if (this.#current(generation)) this.#receive(value); },
					/** A transport change never changes the persisted generation outcome. */
					connection: state => { if (!this.#current(generation)) return; this.#state.connection = state; if (state !== 'connected') this.#subscribed = false; this.#notice({ type: 'connection', connection: state }); this.#notify(); },
					/** Access loss clears previously displayed restricted data and stops recovery. */
					denied: () => { if (!this.#current(generation)) return; this.#detach(); this.#state.snapshot = null; this.#state.connection = 'denied'; this.#state.synchronizing = false; this.#notice({ type: 'connection', connection: 'denied' }); this.#notify(); },
				});
				if (this.#current(generation)) this.#unsubscribe = unsubscribe; else unsubscribe();
			} catch (error) { if (this.#current(generation)) { this.#state.synchronizing = false; this.#error(error); } throw error; }
		})();
		this.#opening = opening;
		try { await opening; } finally { if (this.#opening === opening) this.#opening = undefined; }
	}

	/** Replaces the baseline only after a validated, current HTTP response. */
	async #baseline(generation: number): Promise<void> {
		const snapshot = agentSnapshotSchema.parse(await this.options.http.load(this.#id!, this.#abort.signal));
		if (!this.#current(generation)) return;
		if (snapshot.cursor.conversationId !== this.#id || snapshot.cursor.view !== this.options.view) throw new Error('Invalid conversation baseline.');
		this.#state.snapshot = snapshot; this.#versions.clear();
		this.#notice({ type: 'snapshot', snapshot: structuredClone(snapshot) }); this.#notify();
	}

	/** Buffers during reconciliation and requests HTTP recovery only for an actual gap/reset. */
	#receive(value: unknown): void {
		try {
			const batch = agentUpdateSchema.parse(value);
			if (batch.kind === 'updates') { this.#checkCursor(batch.after); this.#checkCursor(batch.cursor); this.#checkCursor(batch.through); }
			else if (batch.conversationId !== this.#id || batch.view !== this.options.view) throw new Error('Stream belongs to another conversation.');
			if (batch.kind === 'snapshot_required') this.#resetRequired = true;
			if (this.#recovering || !this.#subscribed || this.#paused || this.#resetRequired || batch.kind === 'updates' && batch.after.sequence > (this.#state.snapshot?.cursor.sequence ?? 0)) {
				this.#buffer.push(batch); this.#bufferBytes += JSON.stringify(batch).length;
				if (this.#buffer.length > 128 || this.#bufferBytes > 262144) { this.#buffer = []; this.#bufferBytes = 0; this.#resetRequired = true; }
				if (this.#subscribed && !this.#paused) void this.#recover();
			} else if (batch.kind === 'updates') this.#apply(batch);
		} catch (error) { this.#paused = true; this.#error(error); }
	}

	/** Recovers a fixed HTTP watermark, then consumes buffered events without duplicates. */
	async #recover(): Promise<void> {
		if (this.#recovering) return this.#recovering;
		if (!this.#state.snapshot || this.#disposed) return;
		const generation = this.#generation;
		this.#state.synchronizing = true; this.#notify();
		const recovering = (async () => {
			try {
				for (let resets = 0; resets < 3; resets++) {
					if (this.#resetRequired) { this.#resetRequired = false; this.#buffer = []; this.#bufferBytes = 0; await this.#baseline(generation); }
					if (!this.#current(generation)) return;
					let through: stream.AgentCursor | undefined;
					for (let pages = 0; pages < 1000; pages++) {
						const batch = agentUpdateSchema.parse(await this.options.http.updates(this.#state.snapshot!.cursor, through, this.#abort.signal));
						if (!this.#current(generation)) return;
						if (batch.kind === 'snapshot_required') { if (batch.conversationId !== this.#id || batch.view !== this.options.view) throw new Error('Invalid recovery identity.'); this.#resetRequired = true; break; }
						this.#checkCursor(batch.after); this.#checkCursor(batch.cursor); this.#checkCursor(batch.through);
						through ??= batch.through;
						if (through.sequence !== batch.through.sequence || batch.hasMore && batch.cursor.sequence <= batch.after.sequence) throw new Error('Invalid recovery progress.');
						this.#apply(batch);
						if (!batch.hasMore) break;
						if (pages === 999) this.#resetRequired = true;
					}
					if (this.#resetRequired) continue;
					const buffered = this.#buffer.splice(0); this.#bufferBytes = 0;
					for (const batch of buffered) {
						if (batch.kind === 'snapshot_required' || batch.after.sequence > this.#state.snapshot!.cursor.sequence) { this.#resetRequired = true; break; }
						this.#apply(batch);
					}
					if (this.#resetRequired) continue;
					this.#state.error = null; this.#paused = false; return;
				}
				throw new Error('The conversation changed too quickly to reconnect. Refresh to load its latest state.');
			} catch (error) { if (this.#current(generation)) { this.#paused = true; this.#error(error); } }
			finally { if (this.#current(generation)) { this.#state.synchronizing = false; this.#notify(); } }
		})();
		this.#recovering = recovering;
		try { await recovering; } finally { if (this.#recovering === recovering) this.#recovering = undefined; }
	}

	/** Applies overlaps once; filtered sequence gaps are represented by the enclosing cursor. */
	#apply(batch: stream.AgentUpdatePage): void {
		const snapshot = this.#state.snapshot!;
		if (batch.cursor.sequence < batch.after.sequence || batch.cursor.sequence > batch.through.sequence || batch.after.sequence > snapshot.cursor.sequence) throw new Error('Invalid stream sequence.');
		let previous = batch.after.sequence;
		for (const entry of batch.events) {
			if (entry.sequence <= previous || entry.sequence > batch.cursor.sequence) throw new Error('Invalid event order.');
			previous = entry.sequence;
			if (entry.sequence <= snapshot.cursor.sequence) continue;
			applyAgentUpdate(snapshot, structuredClone(entry));
			snapshot.cursor = { ...batch.cursor, sequence: entry.sequence };
			if (entry.itemId) this.#versions.set(entry.itemId, entry.sequence);
			this.#notice({ type: 'event', ...structuredClone(entry), cursor: { ...batch.cursor, sequence: entry.sequence } });
		}
		snapshot.cursor = { ...batch.cursor, sequence: Math.max(snapshot.cursor.sequence, batch.cursor.sequence) };
		this.#notify();
	}

	/** Rejects cross-conversation/view delivery before any timeline mutation. */
	#checkCursor(cursor: stream.AgentCursor): void { if (cursor.conversationId !== this.#id || cursor.view !== this.options.view || this.#state.snapshot && cursor.epoch !== this.#state.snapshot.cursor.epoch) throw new Error('Invalid conversation cursor.'); }
	/** Cancels this generation's work without taking over the application socket. */
	#detach(): void { this.#generation++; this.#abort.abort(); this.#abort = new AbortController(); this.#unsubscribe?.(); this.#unsubscribe = undefined; this.#buffer = []; this.#bufferBytes = 0; this.#subscribed = false; this.#resetRequired = false; this.#paused = false; this.#recovering = undefined; this.#opening = undefined; }
	/** Tests ownership after every asynchronous boundary. */
	#current(generation: number): boolean { return generation === this.#generation && !this.#disposed; }
	/** Reports view errors independently from the persisted run result. */
	#error(error: unknown): void {
		const status = (error as { status?: number; statusCode?: number } | null)?.status ?? (error as { statusCode?: number } | null)?.statusCode;
		if (status === 401 || status === 403 || status === 404) { this.#detach(); this.#state.snapshot = null; this.#state.connection = 'denied'; this.#state.synchronizing = false; }
		this.#state.error = error instanceof Error ? error.message : 'Unable to load conversation.'; this.#notice({ type: 'error', message: this.#state.error }); this.#notify(); }
	/** Isolates presentation listeners so they cannot interrupt durable event reconciliation. */
	#notify(): void { for (const listener of this.#listeners) { try { listener(this.getState()); } catch { /* Rendering cannot own execution or recovery. */ } } }
	/** Delivers reconciled notices without allowing observers to change controller state. */
	#notice(notice: stream.AgentStreamNotice): void { for (const listener of this.#notices) { try { listener(structuredClone(notice)); } catch { /* Observer exceptions do not break other attachments. */ } } }
}
