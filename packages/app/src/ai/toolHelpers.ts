import type { RunContext, ToolCallOutputContent } from '@openai/agents';
import type { AgentRunContext, ToolResultBase } from './contracts/Agent';

type AgentToolDetails = {
	toolCall?: {
		callId?: string;
		id?: string;
	};
};

/**
 * Structured tool output that keeps the UI result as JSON text while attaching
 * additional model-visible content such as screenshots.
 */
export type AgentToolModelOutput<TResult extends ToolResultBase> = ToolCallOutputContent[] & {
	readonly __agentToolResult?: TResult;
};

/**
 * Returns the application context passed to an Agents SDK tool invocation.
 *
 * @param runContext - SDK invocation carrying the application's trusted context.
 * @returns The original context with its application type preserved, or null.
 */
export function agentToolContext<TContext = AgentRunContext>(runContext: RunContext<TContext> | undefined): TContext | null {
	return runContext?.context ?? null;
}

/**
 * Returns the stable tool-call id used by stream events and persisted messages.
 */
export function agentToolCallId(details: AgentToolDetails | undefined, fallback: string): string {
	return details?.toolCall?.callId || details?.toolCall?.id || fallback;
}

/**
 * Emits a progress update for the active tool call when the run context is available.
 *
 * @param input - Tool identity, progress values and a context with a progress sink.
 * @returns Promise that resolves after the application has received the update.
 */
export async function emitAgentToolProgress<TContext extends Pick<AgentRunContext, 'emitToolProgress'>>(input: {
	runContext: RunContext<TContext> | undefined;
	details: AgentToolDetails | undefined;
	toolName: string;
	message: string;
	current?: number;
	total?: number;
	data?: Record<string, unknown>;
}): Promise<void> {
	const context = agentToolContext(input.runContext);

	if (!context) return;

	await context.emitToolProgress({
		toolCallId: agentToolCallId(input.details, input.toolName),
		toolName: input.toolName,
		message: input.message,
		current: input.current,
		total: input.total,
		data: input.data,
	});
}

/**
 * Converts an unknown thrown value into a model-visible tool result.
 */
export function agentToolErrorResult(error: unknown, fallback: string): ToolResultBase {
	return {
		status: 'error',
		message: error instanceof Error && error.message ? error.message : fallback,
	};
}

/**
 * Builds a structured tool output with a JSON result and model-visible attachments.
 *
 * The first text item is intentionally kept JSON-compatible so application can
 * persist and render the usual tool result without storing large attachment
 * payloads in conversation history.
 *
 * @param result - UI and history result returned by the tool.
 * @param attachments - Model-visible content attached to the tool output.
 * @returns Structured Agents SDK tool output.
 */
export function agentToolOutputWithModelAttachments<TResult extends ToolResultBase>(
	result: TResult,
	attachments: ToolCallOutputContent[],
): AgentToolModelOutput<TResult> {
	return [
		{
			type: 'text',
			text: JSON.stringify(result),
		},
		...attachments,
	] as AgentToolModelOutput<TResult>;
}

/**
 * Extracts a JSON tool result from structured model-visible tool output.
 *
 * @param value - Tool output returned by the Agents SDK.
 * @returns Parsed JSON result, or null when the output is not a JSON text attachment.
 */
export function agentToolResultFromStructuredOutput(value: unknown): unknown | null {
	const text = structuredToolOutputText(value);

	return text ? parseJson(text) : null;
}

/**
 * Reads the first text item from structured tool output arrays.
 *
 * @param value - Tool output returned by the Agents SDK.
 * @returns Text payload or null.
 */
function structuredToolOutputText(value: unknown): string | null {
	if (!Array.isArray(value)) return null;

	for (const item of value) {
		if (!item || typeof item !== 'object') continue;

		const record = item as Record<string, unknown>;

		if ((record.type === 'text' || record.type === 'input_text') && typeof record.text === 'string') {
			return record.text;
		}
	}

	return null;
}

/**
 * Parses JSON and returns null when the input is not valid JSON.
 *
 * @param value - JSON string to parse.
 * @returns Parsed JSON value, or null.
 */
function parseJson(value: string): unknown | null {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}
