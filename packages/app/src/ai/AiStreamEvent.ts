import { ActiveRecord } from '@db3.ai/app/db';
import { AiConversation } from './AiConversation';
import type { AgentConversationEvent } from './contracts/AgentConversationStream';

/** Bounded replay journal. Canonical text and tool results remain in existing AI records. */
export class AiStreamEvent extends ActiveRecord.define({
	table: 'ai_stream_events',
	fields: field => ({
		id: field.ulid(),
		conversation: field.link(() => AiConversation, { column: 'conversation_id', required: true, onDelete: 'CASCADE', indexes: [{ name: 'ai_stream_events_conversation_sequence', columns: ['conversation_id', 'sequence'], unique: true }] }),
		sequence: field.integer({ required: true, unsigned: true }),
		aiRequestId: field.string({ column: 'ai_request_id', required: true, length: 26 }),
		attempt: field.integer({ required: true, unsigned: true }),
		itemId: field.string({ column: 'item_id', length: 255 }),
		event: field.json<AgentConversationEvent>({ required: true }),
		createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
	}),
}) {}
