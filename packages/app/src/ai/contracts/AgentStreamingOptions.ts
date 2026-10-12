import type { AiConversation } from '../AiConversation';
import type { DispatchOptions } from '@db3.ai/app/queue';
import type { AgentConversationTimelineItem } from './AgentProtocol';
import type { AgentReadContext, AgentView } from './AgentConversationStream';

/** Opt-in recording and application policy; install the stream schema before enabling. */
export interface AgentStreamingOptions {
	enabled: boolean;
	/** Ordinary text flush interval, default 100 ms. Idle agents do not poll. */
	flushIntervalMs?: number;
	/** Replay window after completion, default one day. Active runs are retained. */
	replayRetentionMs?: number;
	/** Rechecked for every HTTP read, subscription and socket delivery. Missing policy denies. */
	authorize?(context: AgentReadContext, conversation: AiConversation, view: AgentView): boolean | Promise<boolean>;
	/** Separate mutation policy; read permission alone never permits stopping a run. Missing policy denies. */
	authorizeStop?(context: AgentReadContext, conversation: AiConversation): boolean | Promise<boolean>;
	/** Explicit presentation policy for normal-user tool payloads. Omitted tools remain private. */
	projectTool?(item: Extract<AgentConversationTimelineItem, { kind: 'tool' }>): Extract<AgentConversationTimelineItem, { kind: 'tool' }> | null;
}

/** Queue options for one logical submission; reuse a key after an uncertain response. */
export interface AgentQueueOptions extends DispatchOptions { idempotencyKey?: string }
