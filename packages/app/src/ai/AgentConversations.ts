import type { AgentStreamingOptions } from './contracts/AgentStreamingOptions';
import { ActiveRecord } from '@db3.ai/app/db';
import { RunnableJob } from '@db3.ai/app/queue';
import { databaseTransactionCommit } from '../db/databaseTransactionCommit';
import { app } from '../server/appContext';
import { agentConversationTimeline } from './AgentHistory';
import type { Ai } from './Ai';
import type { AiConversation } from './AiConversation';
import type { AgentConversationTimelineItem } from './contracts/Agent';
import type * as stream from './contracts/AgentConversationStream';
import type { AgentConversationAttention } from './contracts/AgentConversationAttention';

/** Saved conversation history, execution control and best-effort live publication. */
export class AgentConversations {
	readonly #publishing = new Map<string, Promise<void>>();
	readonly #pendingFrames = new Map<string, number>();
	readonly #corrections = new Map<string, { aiRequestId: string; attempt: number }>();
	readonly #stopListeners = new Map<string, Set<() => void>>();
	readonly #changePublishing = new Set<Promise<void>>();

	/** Binds the application's models and access policies. */
	constructor(readonly ai: Ai, readonly options?: AgentStreamingOptions) {
		if (options?.flushIntervalMs !== undefined && (!Number.isFinite(options.flushIntervalMs) || options.flushIntervalMs < 1)) throw new Error('AI stream flush interval must be positive.');
	}

	/** Whether conversation lifecycle and live delivery are enabled. */
	get enabled(): boolean { return this.options?.enabled === true; }

	/** Projects attention for a trusted reader after the host has authorized the conversation. */
	attentionFor(context: stream.AgentReadContext, conversation: AiConversation): stream.AgentConversationSnapshot['attention'] {
		const attention = conversation.streamState?.attention;
		return attention ? { id: attention.id, kind: attention.kind, unread: !attention.readBy.includes(context.userId) } : null;
	}

	/**
	 * Records a trusted producer's occurrence under the conversation lock. Duplicate
	 * keys preserve receipts; reading an occurrence never approves or resumes work.
	 */
	async requestAttention(conversationId: string, input: { id: string; kind: AgentConversationAttention['kind'] }): Promise<void> {
		if (!input.id || input.id.length > 160 || !['completed', 'failed', 'blocked', 'approval', 'input'].includes(input.kind)) throw new AgentConversationReadError(400, 'Invalid attention occurrence.');
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		// Transaction invariant: Avoid replacing attention while losing concurrent run/queue state stored in
		// the same conversation JSON.
		// TODO(transaction-review): This patches one conversation row; evaluate an atomic attention-field
		// update or revision compare-and-swap instead of locking the full read/modify/write.
		const changed = await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', conversationId).forUpdate().firstOrFail();
			if (!conversation.streamState) throw new AgentConversationReadError(409, 'Conversation has no admitted run.');
			if (conversation.streamState.attention?.id === input.id) return false;
			conversation.streamState.attention = { ...input, createdAt: new Date().toISOString(), readBy: [] };
			await this.ai.models.conversation.where('id', conversationId).patch({ streamState: conversation.streamState });
			return true;
		});
		if (changed) this.notifyAttention(conversationId, committed);
	}

	/** Acknowledges only the occurrence actually rendered; stale tabs cannot clear newer output. */
	async markRead(context: stream.AgentReadContext, input: { conversationId: string; attentionId: string }): Promise<void> {
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		// Transaction invariant: Avoid acknowledging a newer attention occurrence by mistake or losing another
		// reader's acknowledgement in the shared JSON state.
		// TODO(transaction-review): This patches one row; assess an attention-id-conditional JSON update that
		// preserves run state and deduplicates readBy.
		const changed = await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', input.conversationId).forUpdate().first();
			await this.#authorize(context, input.conversationId, 'conversation');
			const attention = conversation?.streamState?.attention;
			if (!attention || attention.id !== input.attentionId || attention.readBy.includes(context.userId)) return false;
			attention.readBy.push(context.userId);
			await this.ai.models.conversation.where('id', input.conversationId).patch({ streamState: conversation!.streamState });
			return true;
		});
		if (changed) this.notifyAttention(input.conversationId, committed);
	}

	/** Delivers an invalidation outside the transaction; durable state survives delivery failure. */
	notifyAttention(conversationId: string, committed?: Promise<boolean>): void {
		this.#notifyChange(conversationId, this.options?.onAttentionChanged, committed);
	}

	/** Publishes aggregate activity invalidation after commit, independent of conversation viewers. */
	notifyRunState(conversationId: string, committed?: Promise<boolean>): void {
		this.#notifyChange(conversationId, this.options?.onRunStateChanged, committed);
	}

	/** Reloads committed state outside transaction scope; rollback and transport failures cannot affect execution. */
	#notifyChange(conversationId: string, changed: ((conversation: AiConversation) => void | Promise<void>) | undefined, committed?: Promise<boolean>): void {
		if (!changed) return;
		const database = app().db.knex;
		/** Restores ordinary model scope after an outer transaction closes. */
		const deliver = async (): Promise<void> => ActiveRecord.withDb(database, async () => {
			const conversation = await this.ai.models.conversation.find(conversationId);
			if (conversation) await changed(conversation);
		});
		const work = (committed ? committed.then(success => { if (success) return deliver(); }) : deliver()).catch(() => undefined).finally(() => { this.#changePublishing.delete(work); });
		this.#changePublishing.add(work);
	}

	/**
	 * Stops the current turn and queued inputs atomically. No viewer-supplied run ID
	 * is needed. Saved messages remain; external tools stop cooperatively.
	 */
	async stop(context: stream.AgentReadContext, input: stream.AgentStopInput): Promise<stream.AgentStopResult> {
		if (!input.conversationId) throw new AgentConversationReadError(400, 'A conversation is required.');
		if (!this.enabled || !context.userId || !this.options?.authorizeStop) throw new AgentConversationReadError(404, 'Conversation not found.');
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		const stopped: string[] = [];
		// Transaction invariant: Avoid a conversation marked stopped while its active/pending requests remain
		// runnable, or cancelling requests without removing them from its queue.
		const result = await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', input.conversationId).forUpdate().first();
			const scope = conversation?.get(this.ai.scopeField) as string | { id?: string } | null;
			if (!conversation || context.scopeId !== undefined && context.scopeId !== (typeof scope === 'string' ? scope : scope?.id) || !await this.options!.authorizeStop!(context, conversation)) throw new AgentConversationReadError(404, 'Conversation not found.');
			const state = conversation.streamState;
			if (state) {
				for (const id of state.pending ?? []) { await this.#cancelRequest(id); stopped.push(id); }
				state.pending = [];
				if (['queued', 'running', 'waiting'].includes(state.run.status)) {
					await this.#settleStop(conversation, 'Conversation stopped.', 'cancelled');
					stopped.push(state.run.aiRequestId);
				} else await conversation.save();
			}
			return { conversationId: input.conversationId, aiRequestId: state?.run.aiRequestId ?? null, status: conversation.streamState?.run.status ?? null };
		});
		this.#afterStateChange(input.conversationId, stopped, committed);
		return result;
	}

	/** Wakes a local execution promptly; remote workers observe the same durable fence. */
	onStop(aiRequestId: string, listener: () => void): () => void {
		const listeners = this.#stopListeners.get(aiRequestId) ?? new Set<() => void>();
		listeners.add(listener); this.#stopListeners.set(aiRequestId, listeners);
		return () => { listeners.delete(listener); if (!listeners.size) this.#stopListeners.delete(aiRequestId); };
	}

	/** Uses the same fail-closed policy for HTTP reads and every socket delivery. */
	async authorized(context: stream.AgentReadContext, conversationId: string, view: stream.AgentView): Promise<boolean> {
		if (!this.options?.authorize || !context.userId || !['admin', 'conversation', 'status'].includes(view)) return false;
		const conversation = await this.ai.models.conversation.find(conversationId);
		if (!conversation) return false;
		const scope = (conversation as unknown as Record<string, unknown>)[this.ai.scopeField];
		const scopeId = typeof scope === 'string' ? scope : (scope as { id?: string } | null)?.id;
		if (context.scopeId !== undefined && context.scopeId !== scopeId) return false;
		return Boolean(await this.options.authorize(context, conversation, view));
	}

	/** Loads a consistent recent baseline, or a bounded older page without changing execution. */
	async load(context: stream.AgentReadContext, input: { conversationId: string; view: stream.AgentView; before?: number; limit?: number }): Promise<stream.AgentConversationSnapshot> {
		await this.#authorize(context, input.conversationId, input.view);
		if (input.before !== undefined && (!Number.isSafeInteger(input.before) || input.before < 0) || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1)) throw new AgentConversationReadError(400, 'Invalid history page.');
		// Transaction invariant: Intends to avoid returning a timeline, run state and attention from different
		// stream revisions; this boundary does not persist data.
		// TODO(transaction-review): Read-only snapshot takes FOR UPDATE on the conversation. Test whether a
		// consistent read or revision/reload check can preserve the response contract without a write
		// lock/explicit transaction.
		return this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', input.conversationId).forUpdate().firstOrFail();
			const query = this.ai.models.message.where('conversation', input.conversationId).orderBy('sequence', 'desc').limit(Math.min(100, Math.max(1, input.limit ?? 40)));
			if (input.before !== undefined) query.where('sequence', '<', input.before);
			const messages = input.view === 'status' ? [] : (await query.all()).reverse();
			const ids = [...new Set(messages.map(message => message.aiRequest?.id).filter((id): id is string => typeof id === 'string'))];
			const requests = ids.length ? await this.ai.models.request.query().whereIn('id', ids).all() : [];
			const active = conversation.streamState?.run;
			const definitions = requests.flatMap(request => ((request.request as { toolDefinitions?: import('./contracts/Agent').AgentToolDefinition[] } | null)?.toolDefinitions ?? []) as import('./contracts/Agent').AgentToolDefinition[]);
			const timelineOptions = { activeRequestId: active && ['running', 'waiting', 'queued'].includes(active.status) ? active.aiRequestId : null };
			const toolIds = [...new Set(messages.map(message => message.toolCallId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
			// A page can split a call from its result. Hydrate only the tools represented in this page.
			const toolMessages = toolIds.length ? await this.ai.models.message.where('conversation', input.conversationId).whereIn('toolCallId', toolIds).orderBy('sequence', 'asc').all() : [];
			const tools = new Map(agentConversationTimeline(toolMessages, definitions, [], timelineOptions).map(item => [item.id, item]));
			const timeline = agentConversationTimeline(messages, definitions, input.view === 'admin' ? requests : [], timelineOptions).map(item => item.kind === 'tool' ? tools.get(item.id) ?? item : item);
			const entries = timeline.map(item => this.#filterItem(item, input.view)).filter((item): item is stream.AgentTimelineEntry => item !== null);
			const first = messages[0]?.sequence;
			const older = first !== undefined && first !== null && await this.ai.models.message.where('conversation', input.conversationId).where('sequence', '<', first).first() ? first : null;
			return { conversationId: input.conversationId, view: input.view, timeline: entries, run: this.#publicRun(conversation.streamState?.run ?? null, input.view), activity: conversation.streamState?.activity ?? null, older, queued: conversation.streamState?.pending?.length ?? 0, attention: this.attentionFor(context, conversation) };
		});
	}


	/**
	 * Queues bounded, transient delivery without awaiting transport or affecting execution.
	 * Overloaded/offline viewers recover saved messages by HTTP; no outbox or replay log exists.
	 */
	publish(conversationId: string, aiRequestId: string, attempt: number, event: stream.AgentConversationEvent, itemId: string | null = null): void {
		const count = this.#pendingFrames.get(conversationId) ?? 0;
		if (count >= 64) { this.#corrections.set(conversationId, { aiRequestId, attempt }); return; }
		this.#pendingFrames.set(conversationId, count + 1);
		const previous = this.#publishing.get(conversationId) ?? Promise.resolve();
		const work = previous.then(async () => {
			for (const view of ['admin', 'conversation', 'status'] as const) {
				let projected = this.#projectEvent(event, view);
				if (!projected) continue;
				if (Buffer.byteLength(JSON.stringify(projected)) > 24_000) projected = { type: 'history.changed' };
				const frame: stream.AgentLiveUpdate = { conversationId, view, aiRequestId, attempt, itemId, event: projected };
				await app().webSockets.channel(`ai:conversation:${conversationId}:${view}`).publish('updates', frame);
			}
		}).catch(() => undefined).finally(() => {
			const remaining = (this.#pendingFrames.get(conversationId) ?? 1) - 1;
			if (remaining) this.#pendingFrames.set(conversationId, remaining); else this.#pendingFrames.delete(conversationId);
			if (this.#publishing.get(conversationId) === work) this.#publishing.delete(conversationId);
			const correction = !remaining && this.#corrections.get(conversationId);
			if (correction) {
				this.#corrections.delete(conversationId);
				this.publish(conversationId, correction.aiRequestId, correction.attempt, { type: 'history.changed' });
			}
		});
		this.#publishing.set(conversationId, work);
	}

	/** Drains already queued local delivery for shutdown/tests; never calls a provider. */
	async drain(): Promise<void> { while (this.#publishing.size || this.#changePublishing.size) await Promise.all([...this.#publishing.values(), ...this.#changePublishing]); }

	/** Publishes a fresh lifecycle correction after a committed control transition. */
	async notifyState(conversationId: string): Promise<void> {
		const conversation = await this.ai.models.conversation.find(conversationId);
		const state = conversation?.streamState;
		if (!state) return;
		this.publish(conversationId, state.run.aiRequestId, state.run.attempt, { type: 'run.state', run: state.run, queued: state.pending?.length ?? 0 });
		this.publish(conversationId, state.run.aiRequestId, state.run.attempt, { type: 'status.changed', activity: state.activity });
	}

	/** Reflects a released queue attempt independently of a failed writer. */
	async settleQueuedRetry(aiRequestId: string, attempt: number): Promise<void> {
		if (!this.enabled) return;
		const request = await this.ai.models.request.find(aiRequestId);
		if (!request?.conversation?.id) return;
		const id = String(request.conversation.id);
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		// Transaction invariant: Avoid a request left terminal while its conversation advertises a waiting
		// retry, or a stale retry reopening a completed/cancelled turn.
		await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', id).forUpdate().firstOrFail();
			const previous = conversation.streamState;
			if (!previous || previous.run.aiRequestId !== aiRequestId || previous.run.attempt > attempt || ['completed', 'cancelled', 'blocked'].includes(previous.run.status)) return;
			const root = await this.ai.models.request.where('id', aiRequestId).forUpdate().firstOrFail();
			if (root.status === 'completed' || root.errorCode === 'agent_cancelled') return;
			await this.ai.models.request.where('id', aiRequestId).patch({ status: 'pending', completedAt: null, errorCode: null, errorMessage: null });
			conversation.streamState = { ...previous, owner: null, run: { ...previous.run, attempt, status: 'waiting', completedAt: null, error: null }, activity: { code: 'waiting', label: 'Waiting to retry' } };
			await conversation.save();
		});
		this.#afterStateChange(id, [aiRequestId], committed);
	}

	/** Settles terminal failures without reusing a failed recorder or replaying provider work. */
	async settleQueuedStop(aiRequestId: string, message: string, status: 'failed' | 'blocked' | 'cancelled' = 'failed', expectedOwner?: string): Promise<void> {
		if (!this.enabled) return;
		const request = await this.ai.models.request.find(aiRequestId);
		if (!request?.conversation?.id) return;
		const id = String(request.conversation.id);
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		// Transaction invariant: Avoid failing a request without removing/settling its conversation queue
		// state, or an obsolete owner stopping a replacement run.
		await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', id).forUpdate().firstOrFail();
			if (expectedOwner && conversation.streamState?.owner && conversation.streamState.owner !== expectedOwner) return;
			if (conversation.streamState?.run.aiRequestId === aiRequestId) await this.#settleStop(conversation, message, status);
			else if (conversation.streamState?.pending?.includes(aiRequestId)) {
				await this.ai.models.request.where('id', aiRequestId).where('status', 'pending').patch({ status: 'failed', completedAt: new Date(), errorMessage: message });
				conversation.streamState.pending = conversation.streamState.pending.filter(id => id !== aiRequestId);
				await conversation.save();
			}
		});
		this.#afterStateChange(id, [aiRequestId], committed);
	}

	/**
	 * Repairs rejected legacy stream admissions only: pending roots with no user
	 * message, provider child, queue job or current/pending ownership. Never retries work.
	 * Call explicitly during an application data migration; returns the repaired count.
	 */
	async repairRejectedRequests(conversationId: string): Promise<number> {
		// Transaction invariant: Avoid cleanup failing a pending request that admission/execution concurrently
		// adopted into the conversation or gave provider/message evidence.
		// TODO(transaction-review): Independent orphan rows are repaired here; review per-request conditional
		// reconciliation and lock participation before retaining the broad repair transaction.
		return this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', conversationId).forUpdate().firstOrFail();
			const roots = await this.ai.models.request.where('conversation', conversationId).where('status', 'pending').where('operation', 'agents.run.stream').forUpdate().all();
			let repaired = 0;
			for (const root of roots) {
				const id = String(root.id);
				const request = root.request as { queueJobId?: unknown } | null;
				if (root.metadata?.transport !== 'ndjson' || root.admissionKey || root.providerRequestId || root.response || (root.totalTokens ?? 0) > 0 || (root.knownCostUSD ?? 0) > 0 || root.parentAiRequest?.id || conversation.streamState?.run.aiRequestId === id || conversation.streamState?.pending?.includes(id) || request?.queueJobId || root.metadata?.jobRunId) continue;
				if (await this.ai.models.request.where('parentAiRequest', id).first()) continue;
				const messages = await this.ai.models.message.where('aiRequest', id).all();
				if (messages.length !== 1 || messages[0]?.role !== 'system' || messages[0]?.metadata?.eventType !== 'system_instructions') continue;
				await root.assign({ status: 'failed', completedAt: new Date(), errorCode: 'agent_admission_rejected', errorMessage: 'This request was rejected before execution started.' }).save();
				repaired++;
			}
			return repaired;
		});
	}

	/** Settles the locked current turn without overwriting a completed run. */
	async #settleStop(conversation: AiConversation, message: string, status: 'failed' | 'blocked' | 'cancelled'): Promise<void> {
		const previous = conversation.streamState!;
		const aiRequestId = previous.run.aiRequestId;
		const root = await this.ai.models.request.findOrFail(aiRequestId);
		if (root.status === 'completed' || ['completed', 'cancelled', 'blocked'].includes(previous.run.status)) return;
		if (status === 'cancelled') await this.#cancelRequest(aiRequestId);
		else await this.ai.models.request.where('id', aiRequestId).where('status', 'pending').patch({ status: 'failed', completedAt: new Date(), errorMessage: message });
		conversation.streamState = { ...previous, owner: null, run: { ...previous.run, status, completedAt: new Date().toISOString(), error: status === 'cancelled' ? null : { message: message.slice(0, 512) } }, activity: { code: status, label: status === 'cancelled' ? 'Stopped' : status.charAt(0).toUpperCase() + status.slice(1) } };
		if (status !== 'cancelled' && previous.attention?.id !== `${aiRequestId}:${status}`) conversation.streamState.attention = { id: `${aiRequestId}:${status}`, kind: status, createdAt: new Date().toISOString(), readBy: [] };
		await conversation.save();
	}

	/** Cancels retained work by exact internal identity, including pending inputs. */
	async #cancelRequest(aiRequestId: string): Promise<void> {
		const root = await this.ai.models.request.findOrFail(aiRequestId);
		if (root.status !== 'pending') return;
		const jobRunId = root.metadata?.jobRunId;
		if (typeof jobRunId === 'string') {
			const job = await RunnableJob.where('id', jobRunId).forUpdate().first();
			const input = job?.input as { aiRequestId?: string; conversationId?: string } | null;
			if (job && input?.aiRequestId === aiRequestId && input.conversationId === root.conversation?.id && (job.status === 'waiting' || job.status === 'running')) await RunnableJob.where('id', jobRunId).patch({ cancelRequestedAt: new Date() });
		}
		await this.ai.models.request.where('id', aiRequestId).where('status', 'pending').patch({ status: 'failed', completedAt: new Date(), errorCode: 'agent_cancelled', errorMessage: 'Conversation stopped.' });
	}

	/** Notifies only after the outer transaction commits, outside its closed database scope. */
	#afterStateChange(conversationId: string, stopped: string[], committed?: Promise<boolean>): void {
		this.notifyAttention(conversationId, committed);
		this.notifyRunState(conversationId, committed);
		const database = app().db.knex;
		/** Restores the ordinary model scope for delivery and local cancellation. */
		const notify = (): void => ActiveRecord.withDb(database, () => {
			void this.notifyState(conversationId).catch(() => undefined);
			for (const id of stopped) for (const listener of this.#stopListeners.get(id) ?? []) listener();
		});
		if (committed) void committed.then(success => { if (success) notify(); }); else notify();
	}

	/** Rejects missing and unauthorized conversations with the same public response. */
	async #authorize(context: stream.AgentReadContext, id: string, view: stream.AgentView): Promise<void> { if (!await this.authorized(context, id, view)) throw new AgentConversationReadError(404, 'Conversation not found.'); }
	/** Serializes authoritative lifecycle changes on the conversation record. */
	// Transaction invariant: Shared connection/scope for the caller's conversation-state and
	// request/message changes; their concrete invalid partial states are documented at each call.
	// TODO(transaction-review): Do not infer that every caller needs this wrapper; review read-only and
	// single-row callers independently.
	async #transaction<T>(work: () => Promise<T>): Promise<T> { return this.ai.models.conversation.getDb().transaction(transaction => ActiveRecord.withDb(transaction, work)); }
	/** Applies presentation policy before HTTP or socket delivery. */
	#filterItem(item: AgentConversationTimelineItem, view: stream.AgentView): AgentConversationTimelineItem | null {
		if (view === 'status') return null;
		if (view === 'admin') return item;
		if (item.kind === 'prompt_context') return null;
		if (item.kind === 'tool') return this.options?.projectTool?.(item) ?? null;
		return item;
	}
	/** Ordinary views receive safe failure text without diagnostic details. */
	#publicRun(run: stream.AgentRunState | null, view: stream.AgentView): stream.AgentRunState | null { return !run || view === 'admin' ? run : { ...run, error: run.error ? { code: run.error.code, message: 'The agent could not complete this run.' } : null }; }
	/** Filters transient frames using the same policy as saved history. */
	#projectEvent(event: stream.AgentConversationEvent, view: stream.AgentView): stream.AgentConversationEvent | null {
		if (event.type === 'run.state') return { ...event, run: this.#publicRun(event.run, view)! };
		if (event.type === 'status.changed' || event.type === 'history.changed') return event;
		if (view === 'status') return null;
		if (event.type === 'item.changed') { const item = this.#filterItem(event.item, view); return item ? { type: 'item.changed', item } : null; }
		if (event.type === 'text.delta' || event.type === 'citation.added' || event.type === 'reasoning.summary.delta') return event;
		return view === 'admin' && event.type === 'tool.progress' ? event : null;
	}
}

/** Public adapter error that never includes SQL, credentials or provider diagnostics. */
export class AgentConversationReadError extends Error {
	/** Associates a safe message with its HTTP response status. */
	constructor(readonly statusCode: 400 | 404 | 409, message: string) { super(message); this.name = 'AgentConversationReadError'; }
}
