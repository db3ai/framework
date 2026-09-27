

import { AI_MESSAGE_ROLE, AI_MESSAGE_TOOL_STATE, AiMessage } from './AiMessage.js';

import { AiRequest } from './AiRequest.js';

import { isAgentCitation, normalizedAgentCitations, type AgentCitation } from '@db3.ai/pure';

import { INTERRUPTED_TOOL_CALL_MESSAGE, unresolvedToolCallIds } from './toolCallRecovery.js';

import { type AgentConversationPromptContext, type AgentConversationTimelineItem, type AgentConversationToolCall, type AgentPromptContextMessage, type AgentToolDefinition, type AgentToolErrorPayload, type AgentToolState } from './contracts/Agent';

/**
 * Converts saved AI messages into the frontend timeline format used by live streams.
 *
 * @param messages - Persisted AI conversation messages.
 * @param toolDefinitions - Tool definitions for the conversation's agent.
 * @returns Ordered frontend timeline items.
 */
export function agentConversationTimeline(
	messages: AiMessage[],
	toolDefinitions: AgentToolDefinition[] = [],
	requests: AiRequest[] = [],
): AgentConversationTimelineItem[] {
	const timeline: AgentConversationTimelineItem[] = [];
	const toolCalls = new Map<string, AgentConversationToolCall>();
	const promptContextsByRequestId = promptContextsForRequests(requests);
	const displayedPromptContextIds = new Set<string>();

	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		const aiRequestId = entityRefId(message.aiRequest);
		const promptContext = aiRequestId ? promptContextsByRequestId.get(aiRequestId) : null;

		if (promptContext && !displayedPromptContextIds.has(promptContext.id)) {
			timeline.push(promptContext);
			displayedPromptContextIds.add(promptContext.id);
		}

		if (isReasoningSummaryMessage(message)) {
			timeline.push(reasoningSummaryFromMessage(message));
			continue;
		}

		if (message.role === AI_MESSAGE_ROLE.user || message.role === AI_MESSAGE_ROLE.assistant) {
			timeline.push({
				kind: 'message',
				id: String(message.id),
				role: message.role,
				content: message.content ?? '',
				citations: citationsFromMessage(message),
				createdAt: dateString(message.createdAt),
			});
			continue;
		}

		if (message.role !== AI_MESSAGE_ROLE.tool) continue;

		const toolCall = toolCallFromMessage(message, toolCalls, toolDefinitions);

		if (!toolCalls.has(toolCall.id)) {
			toolCalls.set(toolCall.id, toolCall);
			timeline.push(toolCall);
		} else {
			updateToolCall(toolCalls.get(toolCall.id) as AgentConversationToolCall, toolCall);
		}
	}

	for (const promptContext of promptContextsByRequestId.values()) {
		if (displayedPromptContextIds.has(promptContext.id)) continue;

		timeline.push(promptContext);
	}

	markInterruptedToolCalls(toolCalls, unresolvedToolCallIds(messages));

	return timeline;
}

/**
 * Replaces restored tool spinners that have no persisted result with an error.
 *
 * Live tool calls are updated through the active stream. A history response has
 * no stream to finish an orphaned call, so leaving it as `calling` would present
 * a permanent spinner and conceal the recoverable interruption.
 *
 * @param toolCalls - Restored timeline tool calls keyed by provider call id.
 * @param interruptedCallIds - Calls with no persisted success or error result.
 */
function markInterruptedToolCalls(
	toolCalls: Map<string, AgentConversationToolCall>,
	interruptedCallIds: Set<string>,
): void {
	for (const callId of interruptedCallIds) {
		const toolCall = toolCalls.get(callId);

		if (!toolCall || toolCall.state !== AI_MESSAGE_TOOL_STATE.calling) continue;

		toolCall.state = AI_MESSAGE_TOOL_STATE.error;
		toolCall.error = {
			message: INTERRUPTED_TOOL_CALL_MESSAGE,
			details: null,
		};
	}
}

/**
 * Returns true when the message stores a provider reasoning summary.
 *
 * @param message - Persisted AI conversation message.
 * @returns True when the row should hydrate as a reasoning-summary timeline item.
 */
function isReasoningSummaryMessage(message: AiMessage): boolean {
	const metadata = recordValue(message.metadata);
	const content = recordValue(message.contentJson);

	return metadata?.eventType === 'reasoning_summary' || content?.type === 'reasoning_summary';
}

/**
 * Builds a reasoning-summary timeline item from one persisted metadata message.
 *
 * @param message - Persisted reasoning summary message.
 * @returns Frontend reasoning summary timeline item.
 */
function reasoningSummaryFromMessage(message: AiMessage): AgentConversationTimelineItem {
	const content = recordValue(message.contentJson);
	const id = stringValue(content?.id) || String(message.id);

	return {
		kind: 'reasoning_summary',
		id,
		text: stringValue(content?.text) || message.content || '',
		createdAt: dateString(message.createdAt),
	};
}

/**
 * Restores normalized citations from an assistant message snapshot.
 *
 * @param message - Persisted user or assistant message.
 * @returns Valid URL citations attached to the message.
 */
function citationsFromMessage(message: AiMessage): AgentCitation[] {
	const content = recordValue(message.contentJson);
	const citations = Array.isArray(content?.citations)
		? content.citations.filter(isAgentCitation)
		: [];

	return normalizedAgentCitations(citations);
}

/**
 * Builds or updates a tool-call timeline item from one persisted tool message.
 */
function toolCallFromMessage(
	message: AiMessage,
	existingToolCalls: Map<string, AgentConversationToolCall>,
	toolDefinitions: AgentToolDefinition[],
): AgentConversationToolCall {
	const content = recordValue(message.contentJson);
	const state = toolState(message.toolState ?? stringValue(content?.state));
	const toolName = message.toolName || stringValue(content?.toolName) || 'unknown_tool';
	const id = message.toolCallId || `${toolName}:${message.id ?? existingToolCalls.size}`;
	const existing = existingToolCalls.get(id);
	const error = state === AI_MESSAGE_TOOL_STATE.error ? toolError(content, message) : null;
	const argumentsValue = content?.arguments ?? existing?.arguments ?? {};

	return {
		kind: 'tool',
		id,
		toolName,
		arguments: hasToolArguments(argumentsValue) ? argumentsValue : existing?.arguments ?? {},
		state,
		definition: toolDefinitions.find(definition => definition.name === toolName) ?? null,
		progressUpdates: existing?.progressUpdates ?? [],
		result: content?.result ?? existing?.result ?? null,
		error,
	};
}

/**
 * Returns prompt-context timeline items keyed by AI request id.
 *
 * @param requests - Request audit rows for the conversation.
 * @returns Prompt-context items keyed by request id.
 */
function promptContextsForRequests(requests: AiRequest[]): Map<string, AgentConversationPromptContext> {
	const promptContexts = new Map<string, AgentConversationPromptContext>();

	for (const request of requests) {
		if (!request.id) continue;

		const promptContext = promptContextFromRequest(request);

		if (promptContext) {
			promptContexts.set(String(request.id), promptContext);
		}
	}

	return promptContexts;
}

/**
 * Converts one persisted AI request prompt snapshot into a timeline item.
 *
 * @param request - AI request audit row to inspect.
 * @returns Prompt-context timeline item, or null when the request has no saved prompt.
 */
function promptContextFromRequest(request: AiRequest): AgentConversationPromptContext | null {
	const payload = recordValue(request.request);
	const messages = promptContextMessagesFromPayload(payload);

	if (!request.id || messages.length === 0) return null;

	return {
		kind: 'prompt_context',
		id: promptContextId(request.id),
		aiRequestId: String(request.id),
		traceId: traceIdFromMetadata(request.metadata),
		model: request.model ?? null,
		createdAt: dateString(request.startedAt ?? request.createdAt),
		messages,
	};
}

/**
 * Reads provider prompt messages from a saved request payload.
 *
 * @param payload - Serialized request payload from `ai_requests.request`.
 * @returns Role-tagged prompt messages suitable for the debug timeline.
 */
function promptContextMessagesFromPayload(payload: Record<string, unknown> | null): AgentPromptContextMessage[] {
	const prompt = Array.isArray(payload?.prompt) ? payload.prompt : [];
	const messages = prompt
		.map(promptContextMessageFromValue)
		.filter((message): message is AgentPromptContextMessage => message !== null);

	if (messages.length > 0) return messages;

	const fallbackMessages: AgentPromptContextMessage[] = [];
	const instructions = stringValue(payload?.instructions);
	const input = promptContextMessagesFromInput(payload?.input);

	if (instructions) {
		fallbackMessages.push({
			role: AI_MESSAGE_ROLE.system,
			content: instructions,
		});
	}

	fallbackMessages.push(...input);

	return fallbackMessages;
}

/**
 * Reads provider input messages from the saved request input array.
 *
 * @param value - Unknown `ai_requests.request.input` value.
 * @returns Prompt-context messages extracted from the provider input.
 */
function promptContextMessagesFromInput(value: unknown): AgentPromptContextMessage[] {
	if (typeof value === 'string') {
		return [
			{
				role: AI_MESSAGE_ROLE.user,
				content: value,
			},
		];
	}

	if (!Array.isArray(value)) return [];

	return value
		.map(promptContextMessageFromValue)
		.filter((message): message is AgentPromptContextMessage => message !== null);
}

/**
 * Converts one unknown prompt array entry into a typed prompt message.
 *
 * @param value - Unknown saved prompt message value.
 * @returns Typed prompt message, or null when role/content is missing.
 */
function promptContextMessageFromValue(value: unknown): AgentPromptContextMessage | null {
	const message = recordValue(value);

	if (!message) return null;

	const toolMessage = promptContextToolMessageFromValue(message);

	if (toolMessage) return toolMessage;

	const role = promptRole(message?.role);
	const content = promptContentText(message?.content);

	if (!role || content === null) return null;

	return {
		role,
		content,
	};
}

/**
 * Converts saved provider tool items into debug timeline messages.
 *
 * @param item - Saved provider prompt item.
 * @returns Prompt-context tool message, or null when the item is not a tool.
 */
function promptContextToolMessageFromValue(item: Record<string, unknown>): AgentPromptContextMessage | null {
	const type = item.type;

	if (type === 'function_call') {
		const name = stringValue(item.name) || 'unknown_tool';

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Tool call: ${name}`,
				`Call ID: ${stringValue(item.callId) || stringValue(item.call_id) || 'unknown'}`,
				'Arguments:',
				promptPayloadText(item.arguments),
			].join('\n'),
		};
	}

	if (type === 'function_call_result') {
		const name = stringValue(item.name) || 'unknown_tool';

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Tool result: ${name}`,
				`Call ID: ${stringValue(item.callId) || stringValue(item.call_id) || 'unknown'}`,
				'Output:',
				promptPayloadText(item.output),
			].join('\n'),
		};
	}

	if (type === 'hosted_tool_call') {
		const name = stringValue(item.name) || 'hosted_tool';
		const output = item.output === undefined ? null : ['Output:', promptPayloadText(item.output)].join('\n');

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Hosted tool: ${name}`,
				`Status: ${stringValue(item.status) || 'unknown'}`,
				'Arguments:',
				promptPayloadText(item.arguments),
				output,
			].filter((line): line is string => line !== null).join('\n'),
		};
	}

	return null;
}

/**
 * Normalizes a provider prompt role to a frontend-supported role.
 *
 * @param value - Unknown role value.
 * @returns Prompt role, or null when unsupported.
 */
function promptRole(value: unknown): AgentPromptContextMessage['role'] | null {
	if (
		value === AI_MESSAGE_ROLE.system
		|| value === AI_MESSAGE_ROLE.user
		|| value === AI_MESSAGE_ROLE.assistant
		|| value === AI_MESSAGE_ROLE.tool
	) {
		return value;
	}

	return null;
}

/**
 * Converts saved prompt content into readable text without truncating it.
 *
 * @param value - Unknown saved prompt content.
 * @returns Prompt content text, or null when no content is available.
 */
function promptContentText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (value === undefined || value === null) return null;
	if (Array.isArray(value)) {
		const content = value
			.map(promptContentPartText)
			.filter((part): part is string => part !== null)
			.join('\n');

		return content || null;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Converts one provider content part into readable text.
 *
 * @param value - Unknown provider content part.
 * @returns Text extracted from the content part, or null when unsupported.
 */
function promptContentPartText(value: unknown): string | null {
	const part = recordValue(value);

	if (!part) return null;
	if (typeof part.text === 'string') return part.text;
	if (typeof part.refusal === 'string') return part.refusal;
	if (typeof part.transcript === 'string') return part.transcript;

	return null;
}

/**
 * Converts an arbitrary saved prompt payload into readable debug text.
 *
 * @param value - Unknown saved prompt payload.
 * @returns Human-readable prompt payload text.
 */
function promptPayloadText(value: unknown): string {
	const content = promptContentText(value);

	if (content !== null) return prettyJsonText(content);

	if (value === undefined) return '{}';

	return prettyJsonText(value);
}

/**
 * Pretty-prints JSON strings and objects without truncating prompt content.
 *
 * @param value - Unknown payload value.
 * @returns Readable JSON or scalar text.
 */
function prettyJsonText(value: unknown): string {
	if (typeof value === 'string') {
		const parsed = parseJson(value);

		if (parsed !== null) return prettyJsonText(parsed);

		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Parses JSON and returns null when the input is not valid JSON.
 *
 * @param value - JSON string to parse.
 * @returns Parsed value or null.
 */
function parseJson(value: string): unknown | null {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

/**
 * Builds a stable timeline id for a prompt-context item.
 *
 * @param requestId - Persisted AI request id.
 * @returns Prompt-context timeline id.
 */
function promptContextId(requestId: string): string {
	return `prompt_context:${requestId}`;
}

/**
 * Applies the latest persisted tool state to an existing timeline item.
 */
function updateToolCall(target: AgentConversationToolCall, source: AgentConversationToolCall): void {
	target.state = source.state;
	if (hasToolArguments(source.arguments)) {
		target.arguments = source.arguments;
	}
	target.result = source.result ?? target.result;
	target.error = source.error;
}

/**
 * Returns true when a saved tool argument payload contains user/model input.
 *
 * @param value - Persisted tool arguments.
 * @returns True when the payload should replace existing arguments.
 */
function hasToolArguments(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (Array.isArray(value)) return value.length > 0;

	const record = recordValue(value);

	if (record) return Object.keys(record).length > 0;

	return true;
}

/**
 * Normalizes persisted tool-state values for the frontend.
 */
function toolState(value: string | null | undefined): AgentToolState {
	if (value === AI_MESSAGE_TOOL_STATE.success) return AI_MESSAGE_TOOL_STATE.success;
	if (value === AI_MESSAGE_TOOL_STATE.error) return AI_MESSAGE_TOOL_STATE.error;

	return AI_MESSAGE_TOOL_STATE.calling;
}

/**
 * Builds a user-friendly tool error payload from a persisted tool message.
 */
function toolError(content: Record<string, unknown> | null, message: AiMessage): AgentToolErrorPayload {
	const result = recordValue(content?.result);
	const resultMessage = stringValue(result?.message);

	return {
		message: resultMessage || message.content || 'The tool failed.',
		details: content?.result ?? null,
	};
}

/**
 * Reads the latest agent trace id from conversation metadata.
 */
function traceIdFromMetadata(metadata: Record<string, unknown> | null): string | null {
	return stringValue(metadata?.lastTraceId) || stringValue(metadata?.traceId);
}

/**
 * Normalizes link-field entity refs to their string id.
 */
function entityRefId(value: unknown): string | null {
	if (!value || typeof value !== 'object') return null;

	const id = (value as { id?: unknown }).id;

	return id === null || id === undefined ? null : String(id);
}

/**
 * Returns an object record when the value is a plain object.
 */
function recordValue(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

	return value as Record<string, unknown>;
}

/**
 * Returns a string value when one is available.
 */
function stringValue(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/**
 * Serializes a Date-like value for API responses.
 */
function dateString(value: Date | null): string {
	return value instanceof Date ? value.toISOString() : new Date().toISOString();
}
