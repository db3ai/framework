import type { AgentConversationTimelineItem, AgentStreamEvent, AgentToolErrorPayload, QueuedAgentRunResponse } from './AgentProtocol';

/** Authorized output projection. Knowing an ID never grants access. */
export type AgentView = 'admin' | 'conversation' | 'status';

/** Position in one authorized conversation projection; never a credential. */
export interface AgentCursor {
	conversationId: string;
	view: AgentView;
	epoch: string;
	sequence: number;
}

/** Persisted lifecycle of the latest logical turn, separate from socket health. */
export interface AgentRunState {
	aiRequestId: string;
	status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'blocked' | 'cancelled';
	attempt: number;
	startedAt: string | null;
	completedAt: string | null;
	error: AgentToolErrorPayload | null;
}

/** Large items remain in their existing records and load through bounded HTTP pages. */
export interface AgentItemReference {
	kind: 'reference';
	id: string;
	itemKind: AgentConversationTimelineItem['kind'];
	/** Opaque authorized HTTP lookup key, separate from display identity. */
	key: string;
}

/** Existing timeline vocabulary plus an on-demand large-content reference. */
export type AgentTimelineEntry = AgentConversationTimelineItem | AgentItemReference;

/** Allowlisted product status, intentionally without arbitrary tool or prompt data. */
export interface AgentActivity { code: string; label: string; current?: number; total?: number }

/** Changes persist before delivery. Message changes reuse the existing timeline reducer. */
export type AgentConversationEvent = AgentStreamEvent
	| { type: 'item.changed'; item: AgentTimelineEntry }
	| { type: 'run.state'; run: AgentRunState }
	| { type: 'status.changed'; activity: AgentActivity | null };

/** Ordered committed change; delivery may repeat and consumers deduplicate by sequence. */
export interface AgentRecordedEvent {
	sequence: number;
	aiRequestId: string;
	attempt: number;
	itemId: string | null;
	event: AgentConversationEvent;
}

/** Consistent HTTP baseline; older history has a separate message-order cursor. */
export interface AgentConversationSnapshot {
	cursor: AgentCursor;
	timeline: AgentTimelineEntry[];
	run: AgentRunState | null;
	activity: AgentActivity | null;
	older: number | null;
}

/** Bounded updates examined through a fixed watermark, including filtered sequences. */
export interface AgentUpdatePage {
	kind: 'updates';
	after: AgentCursor;
	cursor: AgentCursor;
	through: AgentCursor;
	events: AgentRecordedEvent[];
	hasMore: boolean;
}

/** A fresh HTTP baseline is required when bounded recovery is no longer possible. */
export interface AgentSnapshotRequired {
	kind: 'snapshot_required';
	conversationId: string;
	view: AgentView;
	reason: 'cursor_expired' | 'projection_changed' | 'buffer_overflow';
}

/** HTTP recovery and WebSocket delivery use the same validated envelope. */
export type AgentUpdateResult = AgentUpdatePage | AgentSnapshotRequired;

/** Revision-pinned JSON timeline item, fetched in bounded text pages over HTTP. */
export interface AgentItemPage { itemId: string; revision: string; content: string; nextOffset: number | null }

/** Identity supplied by a trusted route or socket adapter, never from request JSON. */
export interface AgentReadContext { userId: string; scopeId?: string }

/** Internal durable cursor and writer fence on the existing conversation record. */
export interface AgentStreamState {
	owner: string | null;
	run: AgentRunState;
	activity: AgentActivity | null;
}

/** One intentional browser send; its UUID is reused for transport retries. */
export interface AgentSendInput { conversationId: string | null; message: string; idempotencyKey: string }

/** Stops exactly the selected turn; a stale request cannot cancel a later turn. */
export interface AgentStopInput { conversationId: string; aiRequestId: string }

/** Acknowledges the durable outcome; an already terminal turn is unchanged. */
export interface AgentStopResult extends AgentStopInput { status: AgentRunState['status'] }

/** App-owned authenticated HTTP boundary. Read-only inspectors omit send. */
export interface AgentHttpAdapter {
	/** Admits work and returns IDs without waiting for generation. */
	send?(input: AgentSendInput, signal: AbortSignal): Promise<QueuedAgentRunResponse>;
	/** Cancels an authorized run independently of viewer/socket lifetime. */
	stop?(input: AgentStopInput, signal: AbortSignal): Promise<AgentStopResult>;
	/** Loads recent saved output, including in-progress text. */
	load(conversationId: string, signal: AbortSignal): Promise<AgentConversationSnapshot>;
	/** Recovers a bounded page, preserving the initial fixed watermark. */
	updates(after: AgentCursor, through: AgentCursor | undefined, signal: AbortSignal): Promise<AgentUpdateResult>;
	/** Loads older history without rewinding live state. */
	history?(conversationId: string, before: number, signal: AbortSignal): Promise<AgentConversationSnapshot>;
	/** Loads one revision-pinned item page. */
	item?(conversationId: string, itemId: string, offset: number, revision: string | undefined, signal: AbortSignal): Promise<AgentItemPage>;
}

/** Subscription callbacks implemented by the application's shared WebSocket owner. */
export interface AgentRealtimeHandlers {
	/** Runs after initial authorization and every successful reconnect. */
	subscribed(): void;
	/** Supplies an unknown frame for runtime validation by the conversation client. */
	update(value: unknown): void;
	/** Reports socket transport health, independently of generation. */
	connection(state: 'connecting' | 'connected' | 'disconnected'): void;
	/** Stops attachment and clears restricted state when authorization is revoked. */
	denied(): void;
}

/** Reuses one app-owned socket per tab. Cleanup only removes this subscription. */
export interface AgentRealtimeAdapter {
	/** Resolves the shared client, creating/connecting it centrally when needed. */
	subscribe(conversationId: string, handlers: AgentRealtimeHandlers): () => void;
}

/** Immutable published browser state; rendering never owns agent execution. */
export interface AgentClientState {
	snapshot: AgentConversationSnapshot | null;
	connection: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'denied';
	synchronizing: boolean;
	sending: boolean;
	canSend: boolean;
	error: string | null;
}

/** Reconciled callback notices. Callbacks must not perform business side effects. */
export type AgentStreamNotice = { type: 'snapshot'; snapshot: AgentConversationSnapshot }
	| ({ type: 'event'; cursor: AgentCursor } & AgentRecordedEvent)
	| { type: 'connection'; connection: AgentClientState['connection'] }
	| { type: 'error'; message: string };
