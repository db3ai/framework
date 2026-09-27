import { ActiveRecord, type FieldBuilder } from '../db';
import type { InAppMessage } from './contracts';

/** Durable inbox item and independent state for one recipient; install through app migrations. */
export class InAppRecord extends ActiveRecord {
	static override table = 'in_app_messages';
	static override requestFillable: string[] = [];

	/** Defines inbox ownership, deduplication and recipient-state storage. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			userId: field.string({ column: 'user_id', required: true, length: 255, maxLength: 255, indexes: [{ name: 'in_app_recipient_scope', columns: ['user_id', 'scope_type', 'scope_id'] }] }),
			scopeType: field.string({ column: 'scope_type', required: true, length: 80, maxLength: 80 }),
			scopeId: field.string({ column: 'scope_id', required: true, length: 255, maxLength: 255 }),
			type: field.string({ required: true, length: 120, maxLength: 120 }),
			message: field.json<InAppMessage>({ required: true }),
			deduplicationHash: field.string({ column: 'deduplication_hash', length: 64, maxLength: 64, unique: true, hidden: true }),
			contentHash: field.string({ column: 'content_hash', required: true, length: 64, maxLength: 64, hidden: true }),
			presentation: field.string({ required: true, length: 16, maxLength: 16 }),
			readAt: field.timestamp({ column: 'read_at' }),
			dismissedAt: field.timestamp({ column: 'dismissed_at' }),
			archivedAt: field.timestamp({ column: 'archived_at' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string;
	declare userId: string;
	declare scopeType: string;
	declare scopeId: string;
	declare type: string;
	declare message: InAppMessage;
	declare deduplicationHash: string | null;
	declare contentHash: string;
	declare presentation: string;
	declare readAt: Date | null;
	declare dismissedAt: Date | null;
	declare archivedAt: Date | null;
	declare createdAt: Date;
}
