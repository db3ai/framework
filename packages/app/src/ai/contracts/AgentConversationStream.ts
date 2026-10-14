import type { AgentConversationTimelineItem, AgentStreamEvent, AgentToolErrorPayload, QueuedAgentRunResponse } from './AgentProtocol';
import type { AgentConversationAttention } from './AgentConversationAttention';

/** Authorized output projection. Knowing an ID never grants access. */
export type AgentView = 'admin' | 'conversation' | 'status';

/** Persisted lifecycle of the current turn, independent of viewer/socket lifetime. */
export interface AgentRunState {
	aiRequestId: string;
	status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'blocked' | 'cancelled';
	attempt: number;
	startedAt: string | null;
	completedAt: string | null;
	error: AgentToolErrorPayload | null;
}

/** Display-ready saved messages, tool outcomes and provider reasoning summaries. */
export type AgentTimelineEntry = AgentConversationTimelineItem;

/** Allowlisted activity, without arbitrary prompts or provider diagnostics. */
export interface AgentActivity { code: string; label: string; current?: number; total?: number }

/** Transient output and canonical saved-item corrections; none are journalled. */
export type AgentConversationEvent = AgentStreamEvent
	| { type: 'item.changed'; item: AgentTimelineEntry }
	| { type: 'history.changed' }
	| { type: 'run.state'; run: AgentRunState; queued: number }
	| { type: 'status.changed'; activity: AgentActivity | null };

/** Best-effort live delivery. Refresh/history, rather than delta replay, repairs missed output. */
export interface AgentLiveUpdate {
	conversationId: string;
	view: AgentView;
	aiRequestId: string;
	attempt: number;
	itemId: string | null;
	event: AgentConversationEvent;
}

/** Recent authoritative history and execution state. Older pages use database message order. */
export interface AgentConversationSnapshot {
	/** Latest occurrence identity for race-safe read acknowledgement after rendering. */
	attention?: { id: string; kind: AgentConversationAttention['kind']; unread: boolean } | null;
	conversationId: string;
	view: AgentView;
	timeline: AgentTimelineEntry[];
	run: AgentRunState | null;
	activity: AgentActivity | null;
	older: number | null;
	queued: number;
}

/** Identity supplied by trusted HTTP/socket adapters, never from request JSON. */
export interface AgentReadContext { userId: string; scopeId?: string }

/** Current writer fence and FIFO pending request IDs on the existing conversation record. */
export interface AgentStreamState {
	/** Read state survives subsequent admissions and remains independent of execution. */
	attention?: AgentConversationAttention;
	owner: string | null;
	run: AgentRunState;
	activity: AgentActivity | null;
	pending?: string[];
}

/** One intentional send; its UUID survives an uncertain HTTP response. */
export interface AgentSendInput { conversationId: string | null; message: string; idempotencyKey: string }

/** Stops the conversation's current turn and queued inputs under its database lock. */
export interface AgentStopInput { conversationId: string }

/** Acknowledges the current turn, or null when this conversation has never run. */
export interface AgentStopResult extends AgentStopInput { aiRequestId: string | null; status: AgentRunState['status'] | null }

/** App-owned authenticated HTTP boundary. Inspectors omit send. */
export interface AgentHttpAdapter {
	/** Admits work, queuing behind an active turn without awaiting generation. */
	send?(input: AgentSendInput, signal: AbortSignal): Promise<QueuedAgentRunResponse>;
	/** Cancels execution independently of the viewing connection. */
	stop?(input: AgentStopInput, signal: AbortSignal): Promise<AgentStopResult>;
	/** Loads saved history and current execution state. */
	load(conversationId: string, signal: AbortSignal): Promise<AgentConversationSnapshot>;
	/** Loads an older page in database order. */
	history?(conversationId: string, before: number, signal: AbortSignal): Promise<AgentConversationSnapshot>;
}

/** Subscription callbacks implemented by the application's shared WebSocket owner. */
export interface AgentRealtimeHandlers {
	/** Runs after authorization on initial connection and every reconnect. */
	subscribed(): void;
	/** Supplies a frame for validation by the shared conversation client. */
	update(value: unknown): void;
	/** Reports transport health independently of execution. */
	connection(state: 'connecting' | 'connected' | 'disconnected'): void;
	/** Clears restricted state when access is revoked. */
	denied(): void;
}

/** Reuses the app's socket; cleanup removes only this conversation subscription. */
export interface AgentRealtimeAdapter {
	/** Connects the app-owned transport and returns subscription cleanup. */
	subscribe(conversationId: string, handlers: AgentRealtimeHandlers): () => void;
}

/** Immutable browser state; presentation never owns execution. */
export interface AgentClientState {
	snapshot: AgentConversationSnapshot | null;
	connection: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'denied';
	synchronizing: boolean;
	sending: boolean;
	canSend: boolean;
	/** Retries the retained submission after an uncertain transport outcome. */
	canRetrySend: boolean;
	error: string | null;
}

/** Observational notices, unsuitable for business side effects. */
export type AgentStreamNotice = { type: 'snapshot'; snapshot: AgentConversationSnapshot }
	| ({ type: 'event' } & AgentLiveUpdate)
	| { type: 'connection'; connection: AgentClientState['connection'] }
	| { type: 'error'; message: string };
