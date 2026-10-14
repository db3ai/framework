import { randomUUID } from 'node:crypto';
import { ulid } from '@db3.ai/pure/ulid';
import { ActiveRecord } from '@db3.ai/app/db';
import { JobRunStoppedError, QueueRetryLaterError, RunnableJob, type QueueableJobContext } from '@db3.ai/app/queue';
import { databaseTransactionCommit } from '../db/databaseTransactionCommit';
import { app } from '../server/appContext';
import { agentConversationTimeline } from './AgentHistory';
import { AgentConversationReadError } from './AgentConversations';
import type { AiConversation } from './AiConversation';
import type { AiMessage } from './AiMessage';
import type * as agent from './contracts/Agent';
import type * as stream from './contracts/AgentConversationStream';

/** Owns run fencing and saved-message corrections; transient deltas live only in memory. */
export class AgentStreamRecorder {
	readonly #owner = randomUUID();
	readonly #service = app().ai.conversations;
	readonly #job = RunnableJob.current();
	readonly #stop = new AbortController();
	readonly #tools = new Set<string>();
	#chain: Promise<unknown> = Promise.resolve();
	#failure: unknown;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: Array<{ event: stream.AgentConversationEvent; itemId: string | null }> = [];
	#textId: string | null = null;
	#attempt = 0;
	#closed = false;
	#claimed = false;
	#controlTimer: ReturnType<typeof setTimeout> | undefined;
	#unsubscribeStop: (() => void) | undefined;

	/** Cooperative provider cancellation follows run ownership, never socket health. */
	get signal(): AbortSignal { return this.#job ? AbortSignal.any([this.#stop.signal, this.#job.signal]) : this.#stop.signal; }
	/** Whether this execution owns the current turn rather than a queued followup. */
	get claimed(): boolean { return this.#claimed; }
	/** Uses the existing persistence state and queue ownership assertion. */
	constructor(readonly state: agent.AgentPersistenceState, readonly context?: QueueableJobContext) {}

	/** Admits queued inputs in FIFO order; only the selected turn may enter execution. */
	async begin(status: 'queued' | 'running'): Promise<void> {
		await this.#write(async conversation => {
			const root = await app().ai.models.request.where('id', this.state.rootAiRequest.id).forUpdate().firstOrFail();
			if (root.status !== 'pending') throw new JobRunStoppedError('cancelled', 'This conversation turn has already ended.');
			const id = String(root.id);
			const prior = conversation.streamState;
			if (prior?.run.aiRequestId === id && ['cancelled', 'blocked', 'completed'].includes(prior.run.status)) throw new JobRunStoppedError(prior.run.status === 'blocked' ? 'blocked' : 'cancelled', 'This conversation turn has already ended.');
			const pending = prior?.pending ?? [];
			const different = prior && prior.run.aiRequestId !== id;
			const active = different && ['queued', 'running', 'waiting'].includes(prior.run.status);
			if (status === 'queued' && (active || pending.length)) {
				if (!pending.includes(id)) pending.push(id);
				conversation.streamState = { ...prior!, pending };
				return;
			}
			if (active || different && pending.length && pending[0] !== id) {
				if (root.operation === 'agents.run.queue') throw new QueueRetryLaterError(2, 'Waiting for the previous conversation turn.');
				throw new AgentConversationReadError(409, 'This conversation already has an active turn.');
			}
			if (this.#job?.id) await root.assign({ metadata: { ...root.metadata, jobRunId: String(this.#job.id) } }).save();
			this.#attempt = status === 'queued' ? 0 : this.context?.job.attempts ?? (prior?.run.aiRequestId === id ? prior.run.attempt : 0) + 1;
			const run: stream.AgentRunState = { aiRequestId: id, status, attempt: this.#attempt, startedAt: status === 'running' ? (prior?.run.aiRequestId === id ? prior.run.startedAt : null) ?? new Date().toISOString() : null, completedAt: null, error: null };
			conversation.streamState = { owner: this.#owner, run, pending: pending.filter(requestId => requestId !== id), attention: prior?.attention, activity: { code: status === 'running' ? 'thinking' : 'queued', label: status === 'running' ? 'Thinking…' : 'Queued' } };
			this.#claimed = true;
		}, false);
		if (status === 'running') {
			this.#unsubscribeStop = this.#service.onStop(String(this.state.rootAiRequest.id), () => { void this.#checkStop().catch(error => this.#abort(error)); });
			await this.#checkStop();
			this.#watchStop();
		}
	}

	/** Saves once at the existing message boundary, then publishes the full canonical item. */
	async message(state: agent.AgentPersistenceState, input: { role: string; contentJson: unknown; metadata: Record<string, unknown> | null }, save: (id?: string) => Promise<AiMessage>): Promise<AiMessage> {
		await this.flush();
		return this.#serialize(() => this.#write(async conversation => {
			const last = await app().ai.models.message.where('conversation', conversation.id).orderBy('sequence', 'desc').first();
			state.nextSequence = (last?.sequence ?? 0) + 1;
			const message = await save(input.metadata?.eventType === 'assistant_message' ? this.#textId ?? undefined : undefined);
			if (message.toolCallId) {
				if (message.toolState === 'calling') this.#tools.add(message.toolCallId); else this.#tools.delete(message.toolCallId);
				if (this.#claimed) conversation.streamState!.activity = this.#tools.size ? { code: 'tool', label: 'Using tools…' } : { code: 'thinking', label: 'Thinking…' };
			}
			const messages = message.toolCallId ? await app().ai.models.message.where('conversation', conversation.id).where('toolCallId', message.toolCallId).orderBy('sequence', 'asc').all() : [message];
			const item = agentConversationTimeline(messages, state.toolDefinitions, [], { activeRequestId: String(state.rootAiRequest.id) })[0];
			if (item) this.#pending.push({ event: { type: 'item.changed', item }, itemId: item.id });
			if (input.metadata?.eventType === 'assistant_message') this.#textId = null;
			return message;
		}));
	}

	/** Fences provider checkpoints just like saved messages, without adding history events. */
	async checkpoint(save: () => Promise<unknown>): Promise<void> { await this.#serialize(() => this.#write(async () => { await save(); })); }

	/** Prompt data stays on its request; authorized viewers reload it through normal history. */
	async prompt(save: () => Promise<void>): Promise<void> {
		await this.#serialize(() => this.#write(async () => { await save(); this.#pending.push({ event: { type: 'history.changed' }, itemId: null }); }));
	}

	/** Coalesces transient text and progress without writing deltas or partial messages to SQL. */
	async emit(event: agent.AgentStreamEvent): Promise<void> {
		if (this.#failure) throw this.#failure;
		if (this.#closed) return;
		if (event.type === 'text.delta' || event.type === 'reasoning.summary.delta') {
			if (event.type === 'text.delta') this.#textId ??= ulid();
			const itemId = event.type === 'text.delta' ? this.#textId : event.id;
			for (let offset = 0; offset < event.delta.length; offset += 2000) {
				const part = { ...event, delta: event.delta.slice(offset, offset + 2000) };
				const previous = this.#pending.at(-1);
				if (previous?.itemId === itemId && previous.event.type === part.type && 'delta' in previous.event && previous.event.delta.length + part.delta.length <= 2000) previous.event.delta += part.delta;
				else this.#pending.push({ event: part, itemId });
				if (this.#pending.length >= 4) await this.flush();
			}
			if (!this.#timer) this.#timer = setTimeout(() => { this.#timer = undefined; void this.flush().catch(error => this.#abort(error)); }, this.#service.options?.flushIntervalMs ?? 100);
		} else if (event.type === 'tool.progress' || event.type === 'citation.added') {
			this.#pending.push({ event, itemId: event.type === 'tool.progress' ? event.id : this.#textId });
			await this.flush();
		}
	}

	/** Flushes transient frames to a bounded local delivery queue; socket errors cannot fail runs. */
	async flush(): Promise<void> {
		if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
		if (this.#failure) throw this.#failure;
		await this.#chain;
		this.#publish(this.#pending.splice(0));
	}

	/** Commits root lifecycle and its current-run state together, preserving queued followups. */
	async status(status: stream.AgentRunState['status'], save?: () => Promise<unknown>, error?: string): Promise<void> {
		await this.flush();
		await this.#serialize(() => this.#write(async conversation => {
			await save?.();
			const previous = conversation.streamState!;
			const terminal = ['completed', 'failed', 'cancelled', 'blocked'].includes(status);
			conversation.streamState = { ...previous, owner: terminal ? null : this.#owner, run: { ...previous.run, status, completedAt: terminal ? new Date().toISOString() : null, error: error ? { message: error.slice(0, 512) } : null }, activity: { code: status, label: status === 'waiting' ? 'Waiting to retry' : status.charAt(0).toUpperCase() + status.slice(1) } };
			if (status === 'completed' || status === 'failed' || status === 'blocked') {
				const id = `${previous.run.aiRequestId}:${status}`;
				if (previous.attention?.id !== id) conversation.streamState.attention = { id, kind: status, createdAt: new Date().toISOString(), readBy: [] };
			}
		}));
	}

	/** Settles a failed writer through a fresh transaction without overriding a newer owner. */
	async fail(message: string): Promise<void> { await this.#service.settleQueuedStop(String(this.state.rootAiRequest.id), message, 'failed', this.#owner); }

	/** Releases only execution-owned resources. Cleanup never replaces an earlier failure. */
	async close(): Promise<void> {
		try { if (!this.#failure) await this.flush(); }
		finally { this.#closed = true; if (this.#timer) clearTimeout(this.#timer); if (this.#controlTimer) clearTimeout(this.#controlTimer); this.#unsubscribeStop?.(); this.#pending = []; }
	}

	/**
	 * Polls silent runs every five seconds; saved writes and local Stop still check
	 * immediately. The timer must inherit the app connection because direct stream
	 * admission starts this watcher inside a transaction that soon commits.
	 */
	#watchStop(): void {
		if (this.#closed || this.#stop.signal.aborted) return;
		ActiveRecord.withDb(app().db.knex, () => {
			this.#controlTimer = setTimeout(() => { void this.#checkStop().then(() => this.#watchStop(), error => this.#abort(error)); }, 5000);
			this.#controlTimer.unref();
		});
	}
	/** Checks the writer fence without holding a lock during provider work. */
	async #checkStop(): Promise<void> { if (!this.#closed) await this.#assertRun(await app().ai.models.conversation.findOrFail(this.state.conversation.id)); }
	/** Discards output that arrives after this execution loses ownership. */
	#abort(error: unknown): void { this.#failure = error; this.#pending = []; this.#stop.abort(error); }
	/** Requires current ownership, or admitted queued ownership while saving its user message. */
	async #assertRun(conversation: AiConversation): Promise<void> {
		if (conversation.streamState?.owner === this.#owner || !this.#claimed && conversation.streamState?.pending?.includes(String(this.state.rootAiRequest.id))) return;
		const root = await app().ai.models.request.findOrFail(this.state.rootAiRequest.id);
		if (root.errorCode === 'agent_cancelled') throw new JobRunStoppedError('cancelled', 'Conversation stopped.');
		throw new Error('Agent writer ownership was lost.');
	}
	/** Serializes saved writes when tools complete concurrently. */
	async #serialize<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(() => { if (this.#failure) throw this.#failure; return work(); });
		this.#chain = next.catch(error => this.#abort(error));
		return next;
	}
	/** Saves stable state with the existing conversation lock and queue execution fence. */
	async #write<T>(work: (conversation: AiConversation) => Promise<T>, fenced = true): Promise<T> {
		await this.#assertOwnership();
		const connection = app().ai.models.conversation.getDb();
		const committed = databaseTransactionCommit(connection);
		const database = app().db.knex;
		let frames: Array<{ event: stream.AgentConversationEvent; itemId: string | null }> = [];
		let attentionChanged = false;
		let runStateChanged = false;
		const result = await connection.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const conversation = await app().ai.models.conversation.where('id', this.state.conversation.id).forUpdate().firstOrFail();
			const attentionId = conversation.streamState?.attention?.id;
			const previousRun = JSON.stringify([conversation.streamState?.run, conversation.streamState?.pending ?? []]);
			if (fenced) await this.#assertRun(conversation);
			await this.#assertOwnership();
			const result = await work(conversation);
			attentionChanged = conversation.streamState?.attention?.id !== attentionId;
			runStateChanged = JSON.stringify([conversation.streamState?.run, conversation.streamState?.pending ?? []]) !== previousRun;
			await app().ai.models.conversation.where('id', conversation.id).patch({ streamState: conversation.streamState });
			frames = this.#pending.splice(0);
			return result;
		}), connection.isTransaction ? undefined : { isolationLevel: 'read committed' });
		/** Leaves transaction scope before dispatching committed corrections. */
		const publish = (): void => ActiveRecord.withDb(database, () => { this.#publish(frames); void this.#service.notifyState(String(this.state.conversation.id)).catch(() => undefined); });
		if (committed) void committed.then(success => { if (success) publish(); }); else publish();
		if (attentionChanged) this.#service.notifyAttention(String(this.state.conversation.id), committed);
		if (runStateChanged) this.#service.notifyRunState(String(this.state.conversation.id), committed);
		return result;
	}
	/** Publishes frames under this internal turn/attempt identity. */
	#publish(frames: Array<{ event: stream.AgentConversationEvent; itemId: string | null }>): void {
		for (const frame of frames) this.#service.publish(String(this.state.conversation.id), String(this.state.rootAiRequest.id), this.#attempt, frame.event, frame.itemId);
	}
	/** Reuses queue claim checks and retained-run cancellation when present. */
	async #assertOwnership(): Promise<void> { await this.context?.assertOwnership?.(); await this.#job?.assertActive(); }
}
