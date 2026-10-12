import type { AgentStreamingOptions } from './contracts/AgentStreamingOptions';
import { createHash } from 'node:crypto';
import { ActiveRecord } from '@db3.ai/app/db';
import { RunnableJob } from '@db3.ai/app/queue';
import { databaseTransactionCommit } from '../db/databaseTransactionCommit';
import { app } from '../server/appContext';
import { agentConversationTimeline } from './AgentHistory';
import { AiStreamEvent } from './AiStreamEvent';
import type { Ai } from './Ai';
import type { AiConversation } from './AiConversation';
import type { AgentConversationTimelineItem } from './contracts/Agent';
import type * as stream from './contracts/AgentConversationStream';

/** Version of the authorized projection and cursor interpretation. */
const EPOCH = '1';
/** Bounds ordinary items well below the shared socket's frame limit. */
const ITEM_BYTES = 8000;

/** Authorized snapshots, bounded replay and durable-to-live delivery for existing AI records. */
export class AgentConversations {
	readonly #publishing = new Map<string, Promise<void>>();
	readonly #dirty = new Set<string>();
	readonly #stopListeners = new Map<string, Set<() => void>>();
	#pruneAfter: string | undefined;
	/** Binds model subclasses and policy without creating another execution service. */
	constructor(readonly ai: Ai, readonly options?: AgentStreamingOptions) {
		if (options?.flushIntervalMs !== undefined && (!Number.isFinite(options.flushIntervalMs) || options.flushIntervalMs < 1)) throw new Error('AI stream flush interval must be positive.');
		if (options?.replayRetentionMs !== undefined && (!Number.isFinite(options.replayRetentionMs) || options.replayRetentionMs < 1000)) throw new Error('AI replay retention must be at least one second.');
	}

	/** Whether this application has installed and enabled durable recording. */
	get enabled(): boolean { return this.options?.enabled === true; }

	/**
	 * Cancels one authorized turn and fences further output in the same transaction.
	 * Existing history is retained. A new send creates a new turn in this conversation.
	 * Already completed work is not undone; external tools stop cooperatively.
	 */
	async stop(context: stream.AgentReadContext, input: stream.AgentStopInput): Promise<stream.AgentStopResult> {
		if (!input.conversationId || !input.aiRequestId) throw new AgentConversationReadError(400, 'A conversation and run are required.');
		if (!this.enabled || !context.userId || !this.options?.authorizeStop) throw new AgentConversationReadError(404, 'Conversation not found.');
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		const result = await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', input.conversationId).forUpdate().first();
			const scope = conversation?.get(this.ai.scopeField) as string | { id?: string } | null;
			if (!conversation || context.scopeId !== undefined && context.scopeId !== (typeof scope === 'string' ? scope : scope?.id) || !await this.options!.authorizeStop!(context, conversation)) throw new AgentConversationReadError(404, 'Conversation not found.');
			if (conversation.streamState?.run.aiRequestId !== input.aiRequestId) throw new AgentConversationReadError(409, 'This conversation has a different current run.');
			if (['queued', 'running', 'waiting'].includes(conversation.streamState.run.status)) await this.#settleStop(conversation, 'Conversation stopped.', 'cancelled');
			return { ...input, status: conversation.streamState.run.status };
		});
		this.#afterStateChange(input.conversationId, input.aiRequestId, committed);
		return result;
	}

	/** Registers a local execution wakeup; workers in other processes observe the durable fence. */
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
		return this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', input.conversationId).forUpdate().firstOrFail();
			const query = this.ai.models.message.where('conversation', input.conversationId).orderBy('sequence', 'desc').limit(Math.min(100, Math.max(1, input.limit ?? 40)));
			if (input.before !== undefined) query.where('sequence', '<', input.before);
			const messages = input.view === 'status' ? [] : (await query.all()).reverse();
			const ids = [...new Set(messages.map(message => message.aiRequest?.id).filter((id): id is string => typeof id === 'string'))];
			const requests = input.view === 'admin' && ids.length ? await this.ai.models.request.query().whereIn('id', ids).all() : [];
			const active = conversation.streamState?.run;
			const definitions = requests.flatMap(request => ((request.request as { toolDefinitions?: import('./contracts/Agent').AgentToolDefinition[] } | null)?.toolDefinitions ?? []) as import('./contracts/Agent').AgentToolDefinition[]);
			const timelineOptions = { activeRequestId: active && ['running', 'waiting', 'queued'].includes(active.status) ? active.aiRequestId : null };
			const toolIds = [...new Set(messages.map(message => message.toolCallId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
			// A page can split a call from its result. Hydrate only the tools represented in this page.
			const toolMessages = toolIds.length ? await this.ai.models.message.where('conversation', input.conversationId).whereIn('toolCallId', toolIds).orderBy('sequence', 'asc').all() : [];
			const tools = new Map(agentConversationTimeline(toolMessages, definitions, [], timelineOptions).map(item => [item.id, item]));
			const timeline = agentConversationTimeline(messages, definitions, requests, timelineOptions).map(item => item.kind === 'tool' ? tools.get(item.id) ?? item : item);
			let bytes = 0;
			const entries = timeline.map(item => {
				const key = item.kind === 'prompt_context' ? `prompt:${item.aiRequestId}` : `message:${messages.find(message => message.id === item.id || message.toolCallId === item.id || (message.contentJson as { id?: string } | null)?.id === item.id)?.id}`;
				const entry = this.projectItem(item, key, input.view);
				if (entry) bytes += Buffer.byteLength(JSON.stringify(entry));
				return entry && bytes > 128_000 ? { kind: 'reference' as const, id: item.id, itemKind: item.kind, key } : entry;
			}).filter((entry): entry is stream.AgentTimelineEntry => entry !== null);
			const first = messages[0]?.sequence;
			const older = first !== undefined && first !== null && await this.ai.models.message.where('conversation', input.conversationId).where('sequence', '<', first).first() ? first : null;
			return { cursor: this.cursor(conversation, input.view), timeline: entries, run: this.#publicRun(conversation.streamState?.run ?? null, input.view), activity: conversation.streamState?.activity ?? null, older };
		});
	}

	/** Returns a revision-pinned JSON item chunk; inaccessible keys reveal no content. */
	async item(context: stream.AgentReadContext, input: { conversationId: string; view: stream.AgentView; itemId: string; offset?: number; revision?: string }): Promise<stream.AgentItemPage> {
		await this.#authorize(context, input.conversationId, input.view);
		if (input.view === 'status') throw new AgentConversationReadError(404, 'Conversation item not found.');
		let item: AgentConversationTimelineItem | undefined;
		const [kind, id] = input.itemId.split(':');
		if (kind === 'prompt' && input.view === 'admin') {
			const request = await this.ai.models.request.where('id', id).where('conversation', input.conversationId).first();
			if (request) item = agentConversationTimeline([], [], [request])[0];
		} else if (kind === 'message') {
			const message = await this.ai.models.message.where('id', id).where('conversation', input.conversationId).first();
			if (message) {
				const messages = message.toolCallId ? await this.ai.models.message.where('conversation', input.conversationId).where('toolCallId', message.toolCallId).orderBy('sequence', 'asc').all() : [message];
				const conversation = await this.ai.models.conversation.findOrFail(input.conversationId);
				const active = conversation.streamState?.run;
				item = agentConversationTimeline(messages, [], [], { activeRequestId: active && ['queued', 'running', 'waiting'].includes(active.status) ? active.aiRequestId : null })[0];
			}
		}
		const projected = item ? this.#filterItem(item, input.view) : null;
		if (!projected) throw new AgentConversationReadError(404, 'Conversation item not found.');
		const content = JSON.stringify(projected);
		const revision = createHash('sha256').update(content).digest('hex');
		if (input.revision && input.revision !== revision) throw new AgentConversationReadError(409, 'Conversation item changed. Reload it.');
		const offset = input.offset ?? 0;
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length) throw new AgentConversationReadError(400, 'Invalid item offset.');
		const end = Math.min(content.length, offset + 4000);
		return { itemId: input.itemId, revision, content: content.slice(offset, end), nextOffset: end < content.length ? end : null };
	}

	/** Reads after the applied cursor through one fixed watermark; no socket history replay. */
	async updates(context: stream.AgentReadContext, after: stream.AgentCursor, through?: stream.AgentCursor): Promise<stream.AgentUpdateResult> {
		await this.#authorize(context, after.conversationId, after.view);
		return this.readUpdates(after, through);
	}

	/** Internal trusted relay read; public callers must use updates with authorization. */
	async readUpdates(after: stream.AgentCursor, through?: stream.AgentCursor): Promise<stream.AgentUpdateResult> {
		const conversation = await this.ai.models.conversation.findOrFail(after.conversationId);
		const current = this.cursor(conversation, after.view);
		if (!Number.isSafeInteger(after.sequence) || after.sequence < 0 || after.sequence > current.sequence) throw new AgentConversationReadError(400, 'Invalid stream cursor.');
		if (after.epoch !== EPOCH) return { kind: 'snapshot_required', conversationId: after.conversationId, view: after.view, reason: 'projection_changed' };
		const watermark = through ?? current;
		if (watermark.conversationId !== after.conversationId || watermark.view !== after.view || watermark.epoch !== EPOCH || !Number.isSafeInteger(watermark.sequence) || watermark.sequence < after.sequence || watermark.sequence > current.sequence) throw new AgentConversationReadError(400, 'Invalid recovery watermark.');
		const rows = await AiStreamEvent.where('conversation', after.conversationId).where('sequence', '>', after.sequence).where('sequence', '<=', watermark.sequence).orderBy('sequence', 'asc').limit(32).all();
		const events: stream.AgentRecordedEvent[] = [];
		let sequence = after.sequence;
		let bytes = 0;
		for (const row of rows) {
			if (row.sequence !== sequence + 1) return { kind: 'snapshot_required', conversationId: after.conversationId, view: after.view, reason: 'cursor_expired' };
			const event = row.event ? this.#projectEvent(row.event, after.view) : null;
			const size = event ? Buffer.byteLength(JSON.stringify(event)) : 0;
			if (events.length && bytes + size > 24000) break;
			sequence = row.sequence;
			bytes += size;
			if (event) events.push({ sequence, aiRequestId: String(row.aiRequestId), attempt: row.attempt ?? 0, itemId: row.itemId, event });
		}
		if (!rows.length && sequence < watermark.sequence) return { kind: 'snapshot_required', conversationId: after.conversationId, view: after.view, reason: 'cursor_expired' };
		return { kind: 'updates', after, cursor: { ...after, sequence }, through: watermark, events, hasMore: sequence < watermark.sequence };
	}

	/** Bounds one item; large payloads keep their existing durable owner. */
	projectItem(item: AgentConversationTimelineItem, key: string, view: stream.AgentView): stream.AgentTimelineEntry | null {
		const projected = this.#filterItem(item, view);
		if (!projected) return null;
		return Buffer.byteLength(JSON.stringify(projected)) <= ITEM_BYTES ? projected : { kind: 'reference', id: item.id, itemKind: item.kind, key };
	}

	/** Creates a cursor from already-read state without another database query. */
	cursor(conversation: AiConversation, view: stream.AgentView): stream.AgentCursor { return { conversationId: String(conversation.id), view, epoch: EPOCH, sequence: conversation.streamSequence ?? 0 }; }

	/** Starts coalesced delivery after commit. Failure leaves a durable pending cursor. */
	kick(conversationId: string): void {
		if (this.#publishing.has(conversationId)) { this.#dirty.add(conversationId); return; }
		const work = this.#publish(conversationId).catch(() => undefined).finally(() => { this.#publishing.delete(conversationId); if (this.#dirty.delete(conversationId)) this.kick(conversationId); });
		this.#publishing.set(conversationId, work);
	}

	/** Drains local delivery before closing its application; never invokes an AI provider. */
	async drain(): Promise<void> { while (this.#publishing.size) await Promise.all(this.#publishing.values()); }

	/** Reconciles lost publication wakeups using the application's existing scheduler/queue. */
	async publishPending(): Promise<void> {
		if (!this.enabled) return;
		const rows = await this.ai.models.conversation.query().whereRaw('stream_sequence > stream_published_sequence').orderBy('updatedAt', 'asc').limit(100).all();
		for (const row of rows) this.kick(String(row.id));
		await this.drain();
	}

	/**
	 * Reflects a released queue attempt through a fresh writer, even when its
	 * recorder failed. A later attempt or stop wins over this delayed callback.
	 * Custom queue adapters delegate their onRetry hook here; no tools are run.
	 */
	async settleQueuedRetry(aiRequestId: string, attempt: number): Promise<void> {
		if (!this.enabled) return;
		const request = await this.ai.models.request.find(aiRequestId);
		if (!request?.conversation?.id) return;
		const id = String(request.conversation.id);
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', id).forUpdate().firstOrFail();
			const previous = conversation.streamState;
			if (!previous || previous.run.aiRequestId !== aiRequestId || previous.run.attempt > attempt || ['completed', 'cancelled', 'blocked'].includes(previous.run.status)) return;
			if (previous.run.status === 'waiting' && previous.owner === null && previous.run.attempt === attempt) return;
			const root = await this.ai.models.request.where('id', aiRequestId).forUpdate().firstOrFail();
			if (root.status === 'completed' || root.errorCode === 'agent_cancelled') return;
			await this.ai.models.request.where('id', aiRequestId).patch({ status: 'pending', completedAt: null, errorCode: null, errorMessage: null });
			const run: stream.AgentRunState = { ...previous.run, attempt, status: 'waiting', completedAt: null, error: null };
			conversation.streamState = { owner: null, run, activity: { code: 'waiting', label: 'Waiting to retry' } };
			for (const event of [{ type: 'run.state', run }, { type: 'status.changed', activity: conversation.streamState.activity }] as stream.AgentConversationEvent[]) {
				conversation.streamSequence++;
				await AiStreamEvent.create({ conversation: id, sequence: conversation.streamSequence, aiRequestId, attempt, itemId: null, event }).save();
			}
			await conversation.save();
		});
		this.#afterStateChange(id, aiRequestId, committed);
	}

	/** Records a settled queue failure, cancellation or block without executing provider work. */
	async settleQueuedStop(aiRequestId: string, message: string, status: 'failed' | 'blocked' | 'cancelled' = 'failed'): Promise<void> {
		if (!this.enabled) return;
		const request = await this.ai.models.request.find(aiRequestId);
		if (!request?.conversation?.id) return;
		const id = String(request.conversation.id);
		const committed = databaseTransactionCommit(this.ai.models.conversation.getDb());
		await this.#transaction(async () => {
			const conversation = await this.ai.models.conversation.where('id', id).forUpdate().firstOrFail();
			if (!conversation.streamState || conversation.streamState.run.aiRequestId !== aiRequestId) return;
			await this.#settleStop(conversation, message, status);
		});
		this.#afterStateChange(id, aiRequestId, committed);
	}

	/** Settles under the caller's conversation lock, preserving output and idempotency. */
	async #settleStop(conversation: AiConversation, message: string, status: 'failed' | 'blocked' | 'cancelled'): Promise<void> {
		const previous = conversation.streamState!;
		const aiRequestId = previous.run.aiRequestId;
		const root = await this.ai.models.request.findOrFail(aiRequestId);
		if (root.status === 'completed' || ['completed', 'cancelled', 'blocked'].includes(previous.run.status) || previous.run.status === status && previous.owner === null) return;
		const jobRunId = root.metadata?.jobRunId;
		if (status === 'cancelled' && typeof jobRunId === 'string') {
			const job = await RunnableJob.where('id', jobRunId).forUpdate().first();
			const input = job?.input as { aiRequestId?: string; conversationId?: string } | null;
			// Only the retained job owning this exact turn may propagate cancellation to its children.
			if (job && input?.aiRequestId === aiRequestId && input.conversationId === conversation.id && (job.status === 'waiting' || job.status === 'running')) await RunnableJob.where('id', jobRunId).patch({ cancelRequestedAt: new Date() });
		}
		await this.ai.models.request.where('id', aiRequestId).where('status', 'pending').patch({ status: 'failed', completedAt: new Date(), errorMessage: message, ...(status === 'cancelled' ? { errorCode: 'agent_cancelled' } : {}) });
		const run: stream.AgentRunState = { ...previous.run, status, completedAt: new Date().toISOString(), error: status === 'cancelled' ? null : { message: message.slice(0, 512) } };
		conversation.streamState = { owner: null, run, activity: { code: status, label: status === 'cancelled' ? 'Stopped' : status.charAt(0).toUpperCase() + status.slice(1) } };
		const events: Array<{ event: stream.AgentConversationEvent; itemId: string | null }> = [];
		for (const partial of await this.ai.models.message.where('conversation', conversation.id).where('aiRequest', aiRequestId).all()) {
			if (!partial.metadata?.streaming) continue;
			await partial.assign({ metadata: { ...partial.metadata, streaming: false } }).save();
			const item = agentConversationTimeline([partial], [], [], { activeRequestId: null })[0];
			const projected = item && this.projectItem(item, `message:${partial.id}`, 'admin');
			if (projected) events.push({ event: { type: 'item.changed', item: projected }, itemId: item.id });
		}
		events.push({ event: { type: 'run.state', run }, itemId: null }, { event: { type: 'status.changed', activity: conversation.streamState.activity }, itemId: null });
		for (const entry of events) {
			conversation.streamSequence++;
			await AiStreamEvent.create({ conversation: conversation.id, sequence: conversation.streamSequence, aiRequestId, attempt: run.attempt, ...entry }).save();
		}
		await conversation.save();
	}

	/** Publishes and wakes local execution only after all enclosing transactions commit. */
	#afterStateChange(conversationId: string, aiRequestId: string, committed?: Promise<boolean>): void {
		const database = app().db.knex;
		/** Re-enters the ordinary database scope after the mutation's transaction closes. */
		const notify = (): void => ActiveRecord.withDb(database, () => { this.kick(conversationId); for (const listener of this.#stopListeners.get(aiRequestId) ?? []) listener(); });
		if (committed) void committed.then(success => { if (success) notify(); }); else notify();
	}

	/** Expires only terminal replay, retaining current messages and all active streams. */
	async prune(): Promise<number> {
		const deadline = new Date(Date.now() - (this.options?.replayRetentionMs ?? 86_400_000));
		const candidates = AiStreamEvent.where('createdAt', '<', deadline).toKnex().distinct('conversation_id').orderBy('conversation_id').limit(100);
		if (this.#pruneAfter) candidates.where('conversation_id', '>', this.#pruneAfter);
		const ids = await candidates;
		this.#pruneAfter = ids.length === 100 ? String(ids.at(-1)!.conversation_id) : undefined;
		const rows = ids.length ? await this.ai.models.conversation.query().whereIn('id', ids.map(row => row.conversation_id)).all() : [];
		let deleted = 0;
		for (const row of rows) {
			if (!row.streamState?.run.completedAt || new Date(row.streamState.run.completedAt) > deadline || !['completed', 'failed', 'blocked', 'cancelled'].includes(row.streamState.run.status) || row.streamPublishedSequence < row.streamSequence) continue;
			deleted += await AiStreamEvent.where('conversation', row.id).where('createdAt', '<', deadline).delete();
		}
		return deleted;
	}

	/** Sends bounded committed batches; the worker HTTP bridge supplies cross-process delivery. */
	async #publish(conversationId: string): Promise<void> {
		for (let count = 0; count < 100; count++) {
			const conversation = await this.ai.models.conversation.find(conversationId);
			if (!conversation || conversation.streamPublishedSequence >= conversation.streamSequence) return;
			let end = conversation.streamSequence;
			for (const view of ['admin', 'conversation', 'status'] as const) {
				const after = { ...this.cursor(conversation, view), sequence: conversation.streamPublishedSequence };
				const batch = await this.readUpdates(after, { ...after, sequence: end });
				if (batch.kind === 'updates') end = Math.min(end, batch.cursor.sequence);
				await app().webSockets.channel(`ai:conversation:${conversationId}:${view}`).publish('updates', batch);
			}
			await this.ai.models.conversation.where('id', conversationId).where('streamPublishedSequence', '<', end).patch({ streamPublishedSequence: end });
		}
	}

	/** Rejects unauthorized and absent resources with the same safe public error. */
	async #authorize(context: stream.AgentReadContext, id: string, view: stream.AgentView): Promise<void> { if (!await this.authorized(context, id, view)) throw new AgentConversationReadError(404, 'Conversation not found.'); }
	/** Locks the same conversation boundary used by stream writers. */
	async #transaction<T>(work: () => Promise<T>): Promise<T> { return this.ai.models.conversation.getDb().transaction(transaction => ActiveRecord.withDb(transaction, work)); }
	/** Removes private prompt/tool fields before any non-admin delivery. */
	#filterItem(item: AgentConversationTimelineItem, view: stream.AgentView): AgentConversationTimelineItem | null {
		if (view === 'status') return null;
		if (view === 'admin') return item;
		if (item.kind === 'prompt_context' || item.kind === 'reasoning_summary') return null;
		if (item.kind === 'tool') return this.options?.projectTool?.(item) ?? null;
		return item;
	}
	/** Status and ordinary views never receive diagnostic error details. */
	#publicRun(run: stream.AgentRunState | null, view: stream.AgentView): stream.AgentRunState | null { return !run || view === 'admin' ? run : { ...run, error: run.error ? { code: run.error.code, message: 'The agent could not complete this run.' } : null }; }
	/** Applies server projection without disclosing private events in generic JSON. */
	#projectEvent(event: stream.AgentConversationEvent, view: stream.AgentView): stream.AgentConversationEvent | null {
		if (event.type === 'run.state') return { type: 'run.state', run: this.#publicRun(event.run, view)! };
		if (event.type === 'status.changed') return event;
		if (view === 'status') return null;
		if (view === 'admin') return event;
		if (event.type === 'text.delta' || event.type === 'citation.added') return event;
		if (event.type === 'item.changed') {
			if (event.item.kind === 'reference') return event.item.itemKind === 'message' ? event : null;
			const item = this.#filterItem(event.item, view);
			return item ? { type: 'item.changed', item } : null;
		}
		return null;
	}
}

/** Safe HTTP adapter error; does not carry SQL, prompts or provider diagnostics. */
export class AgentConversationReadError extends Error {
	/** Associates a public status with an intentionally bounded error message. */
	constructor(readonly statusCode: 400 | 404 | 409, message: string) { super(message); this.name = 'AgentConversationReadError'; }
}
