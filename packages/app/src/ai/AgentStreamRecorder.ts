import { databaseTransactionCommit } from '../db/databaseTransactionCommit';
import { randomUUID } from 'node:crypto';
import { ActiveRecord } from '@db3.ai/app/db';
import { RunnableJob, type QueueableJobContext } from '@db3.ai/app/queue';
import { app } from '../server/appContext';
import { AiStreamEvent } from './AiStreamEvent';
import { agentConversationTimeline } from './AgentHistory';
import { AgentConversationReadError } from './AgentConversations';
import type { AiConversation } from './AiConversation';
import type { AiMessage } from './AiMessage';
import type * as agent from './contracts/Agent';
import type * as stream from './contracts/AgentConversationStream';

/** Records existing agent events with bounded batching and a conditional queue-writer fence. */
export class AgentStreamRecorder {
	readonly #owner = randomUUID();
	readonly #service = app().ai.conversations;
	readonly #job = RunnableJob.current();
	#chain: Promise<unknown> = Promise.resolve();
	#failure: unknown;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#pending: Array<Extract<agent.AgentStreamEvent, { type: 'text.delta' | 'reasoning.summary.delta' }>> = [];
	#textId: string | null = null;
	readonly #reasoning = new Map<string, string>();
	#attempt = 0;
	#closed = false;
	readonly #stop = new AbortController();

	/** Cancels provider streaming when durable recording or ownership fails. */
	get signal(): AbortSignal { return this.#job ? AbortSignal.any([this.#stop.signal, this.#job.signal]) : this.#stop.signal; }

	/** Uses the existing persistence state and optional delivery ownership assertion. */
	constructor(readonly state: agent.AgentPersistenceState, readonly context?: QueueableJobContext) {}

	/** Claims recording before provider/tool execution; admission refuses a different active turn. */
	async begin(status: 'queued' | 'running'): Promise<void> {
		await this.#assertOwnership();
		await this.#serialize(() => this.#write(async conversation => {
			const prior = conversation.streamState;
			if (prior && prior.run.aiRequestId !== this.state.rootAiRequest.id && ['queued', 'running', 'waiting'].includes(prior.run.status)) throw new AgentConversationReadError(409, 'This conversation already has an active turn.');
			// A new delivery owns fresh output; old interrupted partials remain visible without live spinners.
			const interrupted = prior ? await app().ai.models.message.where('conversation', conversation.id).where('aiRequest', prior.run.aiRequestId).all() : [];
			for (const message of interrupted) {
				if (!message.metadata?.streaming) continue;
				await message.assign({ metadata: { ...message.metadata, streaming: false } }).save();
				await this.#changed(conversation, message);
			}
			this.#attempt = status === 'queued' ? 0 : (prior?.run.aiRequestId === this.state.rootAiRequest.id ? prior.run.attempt : 0) + 1;
			const run: stream.AgentRunState = { aiRequestId: String(this.state.rootAiRequest.id), status, attempt: this.#attempt, startedAt: status === 'running' ? prior?.run.startedAt ?? new Date().toISOString() : null, completedAt: null, error: null };
			conversation.streamState = { owner: this.#owner, run, activity: { code: status, label: status === 'queued' ? 'Queued' : 'Running' } };
			await this.#append(conversation, { type: 'run.state', run }, null);
			await this.#append(conversation, { type: 'status.changed', activity: conversation.streamState.activity }, null);
		}, false));
	}

	/** Atomically writes an existing message and its live change; final text reuses its partial row. */
	async message(state: agent.AgentPersistenceState, input: { role: string; contentJson: unknown; metadata: Record<string, unknown> | null }, save: (id?: string) => Promise<AiMessage>): Promise<AiMessage> {
		await this.flush();
		return this.#serialize(() => this.#write(async conversation => {
			const summaryId = (input.contentJson as { id?: string } | null)?.id;
			const id = input.metadata?.eventType === 'assistant_message' ? this.#textId : input.metadata?.eventType === 'reasoning_summary' && summaryId ? this.#reasoning.get(summaryId) : undefined;
			const last = await app().ai.models.message.where('conversation', conversation.id).orderBy('sequence', 'desc').first();
			state.nextSequence = (last?.sequence ?? 0) + 1;
			const message = await save(id ?? undefined);
			await this.#changed(conversation, message);
			if (input.metadata?.eventType === 'assistant_message') this.#textId = null;
			return message;
		}));
	}

	/** Records prompt mutation and its bounded reference in one transaction. */
	async prompt(save: () => Promise<void>): Promise<void> {
		await this.flush();
		await this.#serialize(() => this.#write(async conversation => {
			await save();
			const id = String(this.state.rootAiRequest.id);
			await this.#append(conversation, { type: 'item.changed', item: { kind: 'reference', id: `prompt_context:${id}`, itemKind: 'prompt_context', key: `prompt:${id}` } }, `prompt_context:${id}`);
		}));
	}

	/** Batches deltas while persisting tool/progress transitions immediately. */
	async emit(event: agent.AgentStreamEvent): Promise<void> {
		if (this.#failure) throw this.#failure;
		if (this.#closed) throw new Error('Agent recorder is closed.');
		if (event.type === 'text.delta' || event.type === 'reasoning.summary.delta') {
			for (let offset = 0; offset < event.delta.length; offset += 2000) {
				const part = { ...event, delta: event.delta.slice(offset, offset + 2000) };
				const previous = this.#pending.at(-1);
				if (previous?.type === part.type && (part.type === 'text.delta' || previous.type === 'reasoning.summary.delta' && previous.id === part.id) && previous.delta.length + part.delta.length <= 2000) previous.delta += part.delta;
				else this.#pending.push(part);
				if (this.#pending.length >= 4) await this.flush();
			}
			if (!this.#timer) this.#timer = setTimeout(() => { this.#timer = undefined; void this.flush().catch(error => { this.#failure = error; }); }, this.#service.options?.flushIntervalMs ?? 100);
			return;
		}
		if (event.type.startsWith('tool.') || event.type === 'citation.added') {
			await this.flush();
			await this.#serialize(() => this.#write(async conversation => {
				if (event.type === 'citation.added') {
					if (!this.#textId) return;
					const message = await app().ai.models.message.findOrFail(this.#textId);
					const content = message.contentJson as { citations?: unknown[] } | null;
					await message.assign({ contentJson: { ...content, citations: [...content?.citations ?? [], event.citation] } }).save();
					await this.#append(conversation, event, this.#textId);
					return;
				}
				if (!('id' in event) || !('toolName' in event)) return;
				if (this.#textId) { await this.#closeText(conversation); this.#textId = null; }
				let message = await app().ai.models.message.where('conversation', conversation.id).where('toolCallId', event.id).orderBy('sequence', 'desc').first();
				if (!message) message = await this.#newMessage('tool', { toolCallId: event.id, toolName: event.toolName, toolState: 'calling', content: `${event.toolName} started.`, contentJson: { arguments: 'arguments' in event ? event.arguments : {}, state: 'calling' } });
				const metadata = message.metadata ?? {};
				if (event.type === 'tool.progress') {
					const progress = Array.isArray(metadata.streamProgress) ? metadata.streamProgress as agent.AgentToolProgressUpdate[] : [];
					await message.assign({ metadata: { ...metadata, streamProgress: [...progress.filter(item => item.id !== event.progress.id), event.progress].slice(-100) } }).save();
				} else {
					const content = message.contentJson as Record<string, unknown> | null;
					const toolState = event.type === 'tool.success' ? 'success' : event.type === 'tool.error' ? 'error' : message.toolState ?? 'calling';
					await message.assign({ toolState, contentJson: { ...content, state: toolState, ...('arguments' in event && event.arguments !== undefined ? { arguments: event.arguments } : {}), ...(event.type === 'tool.success' ? { result: event.result } : event.type === 'tool.error' ? { result: { status: 'error', message: event.error.message, details: event.error.details } } : {}) } }).save();
				}
				await this.#changed(conversation, message);
				if (event.type === 'tool.progress' && Buffer.byteLength(JSON.stringify(event)) < 8000) await this.#append(conversation, event, event.id);
			}));
		}
	}

	/** Persists buffered text before lifecycle/message boundaries; failures stop further execution. */
	async flush(): Promise<void> {
		if (this.#timer) { clearTimeout(this.#timer); this.#timer = undefined; }
		if (this.#failure) throw this.#failure;
		const pending = this.#pending.splice(0);
		if (!pending.length) { await this.#chain; return; }
		await this.#serialize(() => this.#write(async conversation => {
			for (const event of pending) {
				let id = event.type === 'text.delta' ? this.#textId : this.#reasoning.get(event.id);
				let message = id ? await app().ai.models.message.findOrFail(id) : null;
				if (!message) {
					message = await this.#newMessage(event.type === 'text.delta' ? 'assistant' : 'system', { content: '', contentJson: event.type === 'text.delta' ? { type: 'assistant_text', citations: [] } : { type: 'reasoning_summary', id: event.id, text: '' }, metadata: { streamPartial: true, streaming: true, eventType: event.type === 'text.delta' ? 'assistant_message' : 'reasoning_summary', streamAttempt: this.#attempt } });
					id = String(message.id);
					if (event.type === 'text.delta') this.#textId = id; else this.#reasoning.set(event.id, id);
				}
				const content = (message.content ?? '') + event.delta;
				await message.assign({ content, ...(event.type === 'reasoning.summary.delta' ? { contentJson: { type: 'reasoning_summary', id: event.id, text: content } } : {}) }).save();
				await this.#append(conversation, event, event.type === 'text.delta' ? String(message.id) : event.id);
			}
		}));
	}

	/** Commits request lifecycle and its public state together; never reruns a completed provider. */
	async status(status: stream.AgentRunState['status'], save?: () => Promise<unknown>, error?: string): Promise<void> {
		await this.flush();
		await this.#serialize(() => this.#write(async conversation => {
			await save?.();
			await this.#closeText(conversation);
			const previous = conversation.streamState!.run;
			const terminal = ['completed', 'failed', 'cancelled', 'blocked'].includes(status);
			const run: stream.AgentRunState = { ...previous, status, completedAt: terminal ? new Date().toISOString() : null, error: error ? { message: error.slice(0, 512) } : null };
			conversation.streamState = { owner: this.#owner, run, activity: { code: status, label: status.charAt(0).toUpperCase() + status.slice(1) } };
			await this.#append(conversation, { type: 'run.state', run }, null);
			await this.#append(conversation, { type: 'status.changed', activity: conversation.streamState.activity }, null);
		}));
	}

	/** Releases timer ownership even after recording failure; no rejected detached promises escape. */
	async close(): Promise<void> { try { await this.flush(); } finally { this.#closed = true; if (this.#timer) clearTimeout(this.#timer); this.#timer = undefined; } }

	/** Runs writes in order when SDK tools report progress concurrently with model events. */
	async #serialize<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(() => { if (this.#failure) throw this.#failure; return work(); });
		this.#chain = next.catch(error => { this.#failure = error; this.#stop.abort(error); });
		return next;
	}

	/** Uses claim ownership and generation checks; only short database work holds the row lock. */
	async #write<T>(work: (conversation: AiConversation) => Promise<T>, fenced = true): Promise<T> {
		await this.#assertOwnership();
		const committed = databaseTransactionCommit(app().ai.models.conversation.getDb());
		const database = app().db.knex;
		const result = await app().ai.models.conversation.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const conversation = await app().ai.models.conversation.where('id', this.state.conversation.id).forUpdate().firstOrFail();
			if (fenced && conversation.streamState?.owner !== this.#owner) throw new Error('Agent stream writer ownership was lost.');
			await this.#assertOwnership();
			const result = await work(conversation);
			await app().ai.models.conversation.where('id', conversation.id).patch({ streamSequence: conversation.streamSequence, streamState: conversation.streamState });
			return result;
		}));
		// Reuse the inbox commit observer; never publish rolled-back or unfinished outer work.
		if (committed) void committed.then(success => { if (success) ActiveRecord.withDb(database, () => this.#service.kick(String(this.state.conversation.id))); });
		else this.#service.kick(String(this.state.conversation.id));
		return result;
	}

	/** Reuses both lightweight queue claims and retained-run cancellation/fencing when available. */
	async #assertOwnership(): Promise<void> { await this.context?.assertOwnership?.(); await this.#job?.assertActive(); }

	/** Appends one bounded change while holding the conversation's cursor lock. */
	async #append(conversation: AiConversation, event: stream.AgentConversationEvent, itemId: string | null): Promise<void> {
		if (Buffer.byteLength(JSON.stringify(event)) > 28000) throw new Error('Agent stream event exceeds its bounded envelope.');
		conversation.streamSequence = (conversation.streamSequence ?? 0) + 1;
		await AiStreamEvent.create({ conversation: conversation.id, sequence: conversation.streamSequence, aiRequestId: String(this.state.rootAiRequest.id), attempt: this.#attempt, itemId, event }).save();
	}

	/** Publishes the existing history representation, with large content referenced over HTTP. */
	async #changed(conversation: AiConversation, message: AiMessage): Promise<void> {
		const item = agentConversationTimeline([message], this.state.toolDefinitions, [], { activeRequestId: String(this.state.rootAiRequest.id) })[0];
		if (!item) return;
		const bounded = this.#service.projectItem(item, `message:${message.id}`, 'admin');
		if (bounded) await this.#append(conversation, { type: 'item.changed', item: bounded }, item.id);
	}

	/** Creates partial/progress records using the application's configured ownership models. */
	async #newMessage(role: 'assistant' | 'system' | 'tool', values: Record<string, unknown>): Promise<AiMessage> {
		const ai = app().ai;
		const last = await ai.models.message.where('conversation', this.state.conversation.id).orderBy('sequence', 'desc').first();
		return new ai.models.message({ conversation: this.state.conversation.id, aiRequest: this.state.rootAiRequest.id, user: this.state.rootAiRequest.user, [ai.scopeField]: (this.state.rootAiRequest as unknown as Record<string, unknown>)[ai.scopeField], role, sequence: (last?.sequence ?? 0) + 1, provider: this.state.aiRequest.provider, model: this.state.model, ...values }).save();
	}

	/** Ends visible partial spinners without treating interrupted text as future provider input. */
	async #closeText(conversation: AiConversation): Promise<void> {
		for (const id of [this.#textId, ...this.#reasoning.values()]) {
			if (!id) continue;
			const message = await app().ai.models.message.find(id);
			if (!message?.metadata?.streaming) continue;
			await message.assign({ metadata: { ...message.metadata, streaming: false } }).save();
			await this.#changed(conversation, message);
		}
	}
}
