import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db/ActiveRecord';
import type { EntityRef } from '@db3.ai/app/db/fields/LinkField';
import { AiConversation } from './AiConversation.js';
import { AiRequest } from './AiRequest.js';

export const AI_MESSAGE_ROLE = {
	system: 'system',
	user: 'user',
	assistant: 'assistant',
	tool: 'tool',
} as const;

export const AI_MESSAGE_TOOL_STATE = {
	calling: 'calling',
	success: 'success',
	error: 'error',
} as const;

export type AiMessageRole = typeof AI_MESSAGE_ROLE[keyof typeof AI_MESSAGE_ROLE];
export type AiMessageToolState = typeof AI_MESSAGE_TOOL_STATE[keyof typeof AI_MESSAGE_TOOL_STATE];

export class AiMessage extends ActiveRecord {
	static override table = 'ai_messages';
	static override primaryKey = 'id';
	static override comment = 'Normalized AI conversation messages for prompts, assistant output, and tool messages.';

	/**
	 * Defines the persisted message fields used by tracked AI conversations and tool calls.
	 */
	static override fields(field: FieldBuilder): ReturnType<typeof ActiveRecord.fields> {
		return {
			id: field.ulid({
				comment: 'Stable id for this AI message.',
			}),
			conversation: field.link(() => AiConversation, {
				column: 'conversation_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Conversation this message belongs to.',
			}),
			aiRequest: field.link(() => AiRequest, {
				column: 'ai_request_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Provider request that produced or used this message, when available.',
			}),
			user: field.string({ column: 'user_id', index: true, comment: 'Application user identifier, when available.' }),
			scope: field.string({ column: 'scope_id', index: true, comment: 'Application-owned scope identifier, such as a team or project.' }),
			role: field.choice({
				required: true,
				choices: Object.values(AI_MESSAGE_ROLE),
				comment: 'Message role in the AI conversation.',
			}),
			sequence: field.integer({
				required: true,
				unsigned: true,
				comment: 'Monotonic message order within the conversation.',
			}),
			content: field.text({
				required: false,
				comment: 'Text content for this AI message.',
			}),
			contentJson: field.json<unknown>({
				column: 'content_json',
				required: false,
				comment: 'Structured content for this AI message, when the response is not plain text.',
			}),
			toolCallId: field.string({
				column: 'tool_call_id',
				required: false,
				index: true,
				comment: 'Provider or SDK call id for a tool invocation represented by this message.',
			}),
			toolName: field.string({
				column: 'tool_name',
				required: false,
				index: true,
				comment: 'Tool name for tool-call messages.',
			}),
			toolState: field.choice({
				column: 'tool_state',
				required: false,
				choices: Object.values(AI_MESSAGE_TOOL_STATE),
				index: true,
				comment: 'Execution state for a tool-call message.',
			}),
			provider: field.string({
				required: false,
				index: true,
				comment: 'AI provider associated with this message.',
			}),
			model: field.string({
				required: false,
				index: true,
				comment: 'AI model associated with this message.',
			}),
			metadata: field.json<Record<string, unknown>>({
				required: false,
				comment: 'Structured application metadata for this message.',
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
			updatedAt: field.timestamp({
				column: 'updated_at',
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare conversation: EntityRef<AiConversation> | null;
	declare aiRequest: EntityRef<AiRequest> | null;
	declare user: unknown;
	declare scope: unknown;
	declare role: AiMessageRole | null;
	declare sequence: number | null;
	declare content: string | null;
	declare contentJson: unknown | null;
	declare toolCallId: string | null;
	declare toolName: string | null;
	declare toolState: AiMessageToolState | null;
	declare provider: string | null;
	declare model: string | null;
	declare metadata: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
