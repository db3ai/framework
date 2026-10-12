import type { AgentCitation } from '@db3.ai/pure';

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
 * Response returned after queueing an agent run.
 */
export interface QueuedAgentRunResponse {
	/**
	 * Backend queue job id returned by the configured queue driver.
	 */
	jobId: string | number;

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
