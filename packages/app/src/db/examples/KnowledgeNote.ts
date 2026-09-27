import { ActiveRecord } from '@db3.ai/app/db';

/** A workspace-owned note used by the ActiveRecord guide and executable recipe. */
export class KnowledgeNote extends ActiveRecord.define({
	table: 'knowledge_notes',
	requestFillable: ['title', 'body'],

	/**
	 * Defines storage, validation and transport behaviour for each logical field.
	 *
	 * @param field - Framework field factory.
	 * @returns The note's schema; workspace ownership is assigned by trusted code.
	 */
	fields(field) {
		return {
			id: field.ulid(),
			workspace: field.string({ column: 'workspace_id', required: true, maxLength: 26, index: true }),
			title: field.string({ required: true, maxLength: 120 }),
			body: field.text(),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	},
}) {}
