import type { AiConversation } from '../AiConversation';
import type { DispatchOptions } from '@db3.ai/app/queue';
import type { AgentConversationTimelineItem } from './AgentProtocol';
import type { AgentReadContext, AgentView } from './AgentConversationStream';

/** Live conversation updates with authoritative history on existing AI records. */
export interface AgentStreamingOptions {
	enabled: boolean;
	/** Coalesces transient text in memory, default 100 ms; no delta database writes. */
	flushIntervalMs?: number;
	/** Best-effort invalidation after committed run/queued-input changes, excluding text and tool progress. Apps choose authorized activity channels; failures never fail execution. */
	onRunStateChanged?(conversation: AiConversation): void | Promise<void>;
	/** Best-effort invalidation after committed attention/read changes; apps choose recipient channels. */
	onAttentionChanged?(conversation: AiConversation): void | Promise<void>;
	/** Rechecked on HTTP reads, subscriptions and socket delivery. Missing policy denies. */
	authorize?(context: AgentReadContext, conversation: AiConversation, view: AgentView): boolean | Promise<boolean>;
	/** Separate mutation permission; read access never implies stop access. */
	authorizeStop?(context: AgentReadContext, conversation: AiConversation): boolean | Promise<boolean>;
	/** Application presentation policy for user-visible tool payloads. Missing policy hides tools. */
	projectTool?(item: Extract<AgentConversationTimelineItem, { kind: 'tool' }>): Extract<AgentConversationTimelineItem, { kind: 'tool' }> | null;
}

/** Queue options for one logical submission; reuse its key after an uncertain response. */
export interface AgentQueueOptions extends DispatchOptions { idempotencyKey?: string }
