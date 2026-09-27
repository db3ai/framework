import { AI_MESSAGE_ROLE, AI_MESSAGE_TOOL_STATE, type AiMessage, type AiMessageToolState } from './AiMessage.js';

/**
 * User- and model-facing explanation for a persisted call with no saved result.
 */
export const INTERRUPTED_TOOL_CALL_MESSAGE = 'This tool call was interrupted before a result was recorded. Ask the agent to try again if it is still needed.';

/**
 * Finds persisted function calls that have no matching success or error row.
 *
 * A server restart can leave the initial `calling` row durable while preventing
 * the terminal row from being saved. Replaying that call without an output is
 * invalid provider input, so restore boundaries treat it as interrupted.
 *
 * @param messages - Persisted conversation messages in any order.
 * @returns Tool call ids that have a call row but no terminal result row.
 */
export function unresolvedToolCallIds(messages: readonly AiMessage[]): Set<string> {
	const calledIds = new Set<string>();
	const completedIds = new Set<string>();

	for (const message of messages) {
		if (message.role !== AI_MESSAGE_ROLE.tool) continue;

		const content = recordValue(message.contentJson);
		const callId = message.toolCallId || stringValue(content?.callId) || stringValue(content?.call_id);
		const state = persistedToolState(message, content);

		if (!callId || !state) continue;

		if (state === AI_MESSAGE_TOOL_STATE.calling) {
			calledIds.add(callId);
		} else {
			completedIds.add(callId);
		}
	}

	return new Set([...calledIds].filter(callId => !completedIds.has(callId)));
}

/**
 * Reads a supported tool lifecycle state from columns or legacy JSON content.
 *
 * @param message - Persisted tool message.
 * @param content - Parsed structured message content.
 * @returns Normalized tool state, or null when the row is unsupported.
 */
function persistedToolState(message: AiMessage, content: Record<string, unknown> | null): AiMessageToolState | null {
	const state = message.toolState ?? stringValue(content?.state);

	if (
		state === AI_MESSAGE_TOOL_STATE.calling
		|| state === AI_MESSAGE_TOOL_STATE.success
		|| state === AI_MESSAGE_TOOL_STATE.error
	) {
		return state;
	}

	return null;
}

/**
 * Narrows an unknown JSON value to a plain record.
 *
 * @param value - Candidate JSON value.
 * @returns Record value, or null for arrays and primitives.
 */
function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

/**
 * Normalizes a non-empty string value.
 *
 * @param value - Candidate string value.
 * @returns Trimmed string, or null when unavailable.
 */
function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
