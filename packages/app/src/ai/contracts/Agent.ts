import type { AgentConversationTimelineItem, AgentToolDefinition, AgentRunUsage, AgentStreamEvent } from './AgentProtocol';
export type * from './AgentProtocol';
import type { AgentInputItem, AssistantMessageItem, FunctionTool, SystemMessageItem, Tool, UserMessageItem } from '@openai/agents';
import type { SerializedValueEnvelope } from '@db3.ai/app/serialization';
import type { AiConversation } from '../AiConversation.js';
import type { AiRequest, AiRequestRunCostSummary } from '../AiRequest.js';
import type { AIServiceTier } from './AIServiceTier';
import type { AgentCitation } from '@db3.ai/pure';

export type { AgentCitation } from '@db3.ai/pure';

/**
 * Reasoning summary detail level requested from the OpenAI Responses API.
 */
export type AgentReasoningSummaryMode = 'auto' | 'concise' | 'detailed';

/**
 * Reasoning effort requested from reasoning-capable OpenAI models.
 */
export type AgentReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * User, assistant, or system message item accepted by the Agents SDK runner.
 */
export type AgentModelInputMessage = UserMessageItem | AssistantMessageItem | SystemMessageItem;

/**
 * Complete input array passed to the Agents SDK runner.
 */
export type AgentModelInput = AgentInputItem[];

/**
 * Summary row for an agent conversation list item.
 */
export interface AgentConversationSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	lastMessageAt: string | null;
	lastMessagePreview: string;
	messageCount: number;
	traceId: string | null;
	/**
	 * Combined cost of every top-level agent turn and its linked child requests.
	 *
	 * Multi-turn chats sum each completed or pending root tree so conversation
	 * list and detail totals include image and embedding descendants.
	 */
	cost: AiRequestRunCostSummary | null;
}

/**
 * Restored conversation payload returned by the history API.
 */
export interface AgentConversationHistory {
	conversation: AgentConversationSummary;
	toolDefinitions: AgentToolDefinition[];
	timeline: AgentConversationTimelineItem[];
	/** Usage from the latest completed top-level agent turn in this conversation. */
	lastUsage: AgentRunUsage | null;
	/** Whole application credits charged for the latest completed top-level turn. */
	lastCreditCost: number | null;
	/** Recorded provider cost for the latest completed turn, included only for application superusers. */
	lastCostUSD?: number | null;
	/** Sum of settled application credits across every completed top-level turn. */
	conversationCreditCost: number | null;
}

/**
 * Input shape tools use when emitting incremental progress to the stream.
 */
export interface AgentToolProgressInput {
	toolCallId: string;
	toolName: string;
	message: string;
	current?: number;
	total?: number;
	data?: Record<string, unknown>;
}

/**
 * Server-owned context passed to every tool execution.
 *
 * Tenancy identifiers live here so the model cannot choose or override the
 * current user, scope, conversation, or request boundaries through tool input.
 *
 * Improvements: we want to keep this limited to only scope, user and conversation
 * and not have any other implementation details leak into this structure
 */
export interface AgentRunContext {
	userId: string;
	scopeId: string;
	conversationId: string;
	aiRequestId: string | null;
	rootAiRequestId?: string | null;
	traceId: string;
	/** Publishes progress associated with the currently executing tool. */
	emitToolProgress: (progress: AgentToolProgressInput) => void | Promise<void>;
	/** Additional trusted context is supplied by the application's agent subclass. */
	[key: string]: unknown;
}

/**
 * Executable Agents SDK tool with the app's frontend metadata attached.
 */
export type AgentTool = Tool<any> & AgentToolDefinition;

/**
 * Executable function tool with the app's frontend metadata attached.
 */
export type AgentFunctionTool = FunctionTool<any, any, any> & AgentToolDefinition;

/** Trusted constructor context for a serializable application agent. */
export interface BaseAgentContext {
	/** Application user identifier, or a serializable record containing an id. */
	user?: { id: unknown } | string | null;
	/** Application scope identifier, such as an organization or project. */
	scope?: { id: unknown } | string | null;
	conversationId?: string | null;
	parentAiRequestId?: string | null;
}

/**
 * Serializable payload stored on the queue for deferred agent execution.
 */
export interface QueuedAgentRunPayload extends Record<string, unknown> {
	/** Captured processing tier. Legacy payloads retain Standard processing. */
	serviceTier?: AIServiceTier;
	/**
	 * Registered agent name used for worker registration and queue observability.
	 */
	agentName: string;

	/**
	 * Versioned constructor state used to rebuild the concrete agent.
	 */
	agent: SerializedValueEnvelope;

	/**
	 * User or system task message originally supplied to the agent run.
	 */
	message: string;

	/**
	 * Lightweight identifiers consumed without reconstructing the agent.
	 *
	 * This is lifecycle projection data, not constructor state.
	 */
	metadata: Record<string, string>;

	/**
	 * Persisted conversation id the worker should append messages to.
	 */
	conversationId: string;

	/**
	 * Tracked AI request id created before the job was dispatched.
	 */
	aiRequestId: string | null;

	/**
	 * Provider trace id shared by queued setup, SDK execution, and persisted messages.
	 */
	traceId: string;

	/**
	 * Model resolved at dispatch time so the worker runs the same planned model.
	 */
	model: string;

}

/**
 * Final result returned after a live or queued agent run completes.
 */
export interface AgentRunResult {
	conversationId: string;
	aiRequestId: string | null;
	traceId: string;
	usage: AgentRunUsage;
	/** Whole application credits charged for the completed run. */
	creditCost: number | null;
	/** Recorded model and hosted-tool provider cost. */
	costUSD: number | null;
	finalOutput: string;
}

/**
 * Database records and counters needed while persisting a streamed run.
 */
export interface AgentPersistenceState {
	conversation: AiConversation;
	/** Logical run root used for messages, settlement, and recursive reporting. */
	rootAiRequest: AiRequest;
	/** Active append-only provider-attempt request used by tools and usage capture. */
	aiRequest: AiRequest;
	nextSequence: number;
	model: string;
	traceId: string;
	startTimeMs: number;
	metadata: Record<string, string>;
	/**
	 * Frontend-safe metadata derived from the tools configured for this run.
	 */
	toolDefinitions: AgentToolDefinition[];
	/**
	 * Billable hosted provider-tool calls grouped by normalized tool name.
	 */
	hostedToolUsage: Record<string, number>;
	/** Hosted provider-tool call ids already counted for this attempt. */
	hostedToolCallIds: Set<string>;
	/** URL citations collected from the current provider attempt. */
	citations: AgentCitation[];
	/**
	 * Non-empty tool-call arguments keyed by SDK call id.
	 *
	 * Some output events only contain the tool result, so the persistence layer
	 * keeps the original call arguments here until the matching result arrives.
	 */
	toolArgumentsByCallId: Record<string, unknown>;
}

/**
 * Callback used by the agent runner to emit stream events to the caller.
 */
export type AgentEventSink = (event: AgentStreamEvent) => void | Promise<void>;

/**
 * Common success/error envelope returned by agent tools.
 */
export interface ToolResultBase {
	status: 'success' | 'error';
	message?: string;
}
