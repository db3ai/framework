import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db/ActiveRecord';

/** Durable conversation that applications may extend with ownership and domain fields. */
export class AiConversation extends ActiveRecord {
	static override table = 'ai_conversations';
	static override primaryKey = 'id';
	static override comment = 'Groups AI messages and provider requests into one app-level conversation or generated workflow run.';

	/** Defines conversation identity, optional ownership and metadata. */
	static override fields(field: FieldBuilder): ReturnType<typeof ActiveRecord.fields> {
		return {
			id: field.ulid({
				comment: 'Stable id for this AI conversation.',
			}),
			user: field.string({ column: 'user_id', index: true, comment: 'Application user identifier, when available.' }),
			scope: field.string({ column: 'scope_id', index: true, comment: 'Application-owned scope identifier, such as a team or project.' }),
			agent: field.string({
				required: false,
				index: true,
				comment: 'Local agent or feature name that created this conversation.',
			}),
			title: field.string({
				required: false,
				comment: 'Short human-readable title for debugging or future UI display.',
			}),
			metadata: field.jsonString<Record<string, unknown>>({
				required: false,
				comment: 'Structured application metadata for this AI conversation.',
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
	declare user: unknown;
	declare scope: unknown;
	declare agent: string | null;
	declare title: string | null;
	declare metadata: Record<string, unknown> | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
