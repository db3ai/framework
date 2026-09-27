import type { AgentInputItem, AssistantMessageItem, FunctionTool, SystemMessageItem, Tool, UserMessageItem } from '@openai/agents';
import type { QueueJobId } from '@db3.ai/app/queue';
import type { SerializedValueEnvelope } from '@db3.ai/app/serialization';
import type { AiConversation } from '../AiConversation.js';
import type { AiRequest, AiRequestRunCostSummary } from '../AiRequest.js';
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
 * Lifecycle state for a tool call shown in the agent conversation UI.
 */
export type AgentToolState = 'calling' | 'success' | 'error';

/**
 * Frontend-safe metadata for an agent tool.
 *
 * The backend attaches this metadata to the exported tool object so stream
 * events and restored history can describe the tool without importing the
 * executable tool implementation in the browser.
 */
export interface AgentToolDefinition {
	/**
	 * Stable tool name used by the model, stream events, and persisted history.
	 */
	name: string;

	/**
	 * Human-readable tool title for generic UI states.
	 */
	title: string;

	/**
	 * Short explanation of what the tool does for generic UI states.
	 */
	description: string;
}

/**
 * Progress message emitted by a running tool and streamed to the chat UI.
 */
export interface AgentToolProgressUpdate {
	id: string;
	message: string;
	current?: number;
	total?: number;
	data?: Record<string, unknown>;
	createdAt: string;
}

/**
 * Normalized error payload used for tool failures and failed agent runs.
 */
export interface AgentToolErrorPayload {
	/** Stable machine-readable reason used by clients to select a recovery UI. */
	code?: string;

	/** Customer-facing explanation for the failed run. */
	message: string;

	/** Safe diagnostic context for developer tooling. */
	details?: unknown;
}

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
 * Text message item stored in the agent conversation timeline.
 */
export interface AgentConversationMessage {
	kind: 'message';
	id: string;
	role: 'user' | 'assistant';
	content: string;
	/** Normalized source citations attached to this assistant message. */
	citations: AgentCitation[];
	createdAt: string;
	streaming?: boolean;
}

/**
 * One role-tagged message from the exact prompt snapshot sent to the model.
 */
export interface AgentPromptContextMessage {
	/**
	 * Prompt role as supplied to the model provider.
	 */
	role: 'system' | 'user' | 'assistant' | 'tool';

	/**
	 * Complete text content for this prompt message.
	 */
	content: string;
}

/**
 * Debug timeline item containing the model-visible instructions and input.
 *
 * The normal user bubble keeps the user's raw prompt. This item preserves the
 * assembled SDK prompt, including system instructions, previous conversation
 * input items, selected scope context, and other server-owned context that
 * shaped the run.
 */
export interface AgentConversationPromptContext {
	/**
	 * Timeline discriminator used by the frontend renderer.
	 */
	kind: 'prompt_context';

	/**
	 * Stable frontend id for this prompt-context block.
	 */
	id: string;

	/**
	 * AI request audit row that stores this prompt snapshot.
	 */
	aiRequestId: string | null;

	/**
	 * Provider trace id associated with the run.
	 */
	traceId: string | null;

	/**
	 * Provider model selected for the run.
	 */
	model: string | null;

	/**
	 * Timestamp for when the prompt snapshot was created.
	 */
	createdAt: string;

	/**
	 * Visible user message id this context should be displayed before.
	 */
	userMessageId?: string | null;

	/**
	 * Complete role-tagged prompt messages sent to the model.
	 */
	messages: AgentPromptContextMessage[];
}

/**
 * Tool call item stored in the agent conversation timeline.
 */
export interface AgentConversationToolCall {
	kind: 'tool';
	id: string;
	toolName: string;
	arguments: unknown;
	state: AgentToolState;
	definition: AgentToolDefinition | null;
	progressUpdates: AgentToolProgressUpdate[];
	result: unknown;
	error: AgentToolErrorPayload | null;
}

/**
 * Model-generated reasoning summary shown separately from assistant output.
 *
 * This is a provider-generated summary of the model's reasoning process, not
 * raw hidden chain-of-thought. Agents opt in before these items can appear.
 */
export interface AgentConversationReasoningSummary {
	kind: 'reasoning_summary';
	id: string;
	text: string;
	createdAt: string;
	streaming?: boolean;
}

/**
 * Ordered conversation item shown by live streams and restored history.
 */
export type AgentConversationTimelineItem = AgentConversationMessage | AgentConversationPromptContext | AgentConversationToolCall | AgentConversationReasoningSummary;

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
 * Token and request usage reported for a completed agent run.
 */
export interface AgentRunUsage {
	requests: number;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	reasoningTokens: number | null;
	cachedTokens: number | null;
	/** Input tokens written into a billable provider prompt cache. */
	cacheWriteTokens: number | null;
}

/**
 * NDJSON event contract emitted by a live agent run.
 */
export type AgentStreamEvent =
	| {
		type: 'conversation.created';
		conversationId: string;
		aiRequestId: string | null;
		traceId: string;
		toolDefinitions: AgentToolDefinition[];
	}
	| {
		type: 'message.created';
		id: string;
		role: 'user';
		content: string;
		createdAt: string;
	}
	| {
		type: 'prompt.context';
		id: string;
		aiRequestId: string | null;
		traceId: string | null;
		model: string | null;
		createdAt: string;
		userMessageId?: string | null;
		messages: AgentPromptContextMessage[];
	}
	| {
		type: 'tool.calling';
		id: string;
		toolName: string;
		arguments: unknown;
		toolDefinition: AgentToolDefinition | null;
	}
	| {
		type: 'tool.progress';
		id: string;
		toolName: string;
		progress: AgentToolProgressUpdate;
	}
	| {
		type: 'tool.success';
		id: string;
		toolName: string;
		arguments?: unknown;
		result: unknown;
	}
	| {
		type: 'tool.error';
		id: string;
		toolName: string;
		arguments?: unknown;
		error: AgentToolErrorPayload;
	}
	| {
		type: 'text.delta';
		delta: string;
	}
	| {
		type: 'citation.added';
		citation: AgentCitation;
	}
	| {
		type: 'reasoning.summary.delta';
		id: string;
		delta: string;
	}
	| {
		type: 'reasoning.summary.completed';
		id: string;
		text: string;
		createdAt: string;
	}
	| {
		type: 'message.completed';
		id: string;
		role: 'assistant';
		content: string;
		citations: AgentCitation[];
		createdAt: string;
	}
	| {
		type: 'run.completed';
		conversationId: string;
		aiRequestId: string | null;
		traceId: string;
		usage: AgentRunUsage;
		creditCost: number | null;
		/** Recorded provider cost, included only for application superusers. */
		costUSD?: number | null;
		finalOutput: string;
	}
	| {
		type: 'run.error';
		conversationId: string | null;
		aiRequestId: string | null;
		traceId: string | null;
		error: AgentToolErrorPayload;
	};

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
 * Response returned after queueing an agent run.
 */
export interface QueuedAgentRunResponse {
	/**
	 * Backend queue job id returned by the configured queue driver.
	 */
	jobId: QueueJobId;

	/**
	 * Conversation id created or reused for the queued run.
	 */
	conversationId: string;

	/**
	 * Tracked AI request id associated with the queued job.
	 */
	aiRequestId: string | null;

	/**
	 * Provider trace id for debugging and request correlation.
	 */
	traceId: string;
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
