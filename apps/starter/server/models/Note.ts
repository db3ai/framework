import { ActiveRecord } from '@db3.ai/app/db';

/** A private note. Its owner is assigned by authenticated server code, never request data. */
export class Note extends ActiveRecord.define({
	table: 'notes',
	requestFillable: ['title', 'body'],

	/** Defines field validation, logical names and database storage in one place. */
	fields(field) {
		return {
			id: field.ulid(),
			owner: field.string({ column: 'owner_id', required: true, length: 26, maxLength: 26, index: true }),
			title: field.string({ required: true, maxLength: 120 }),
			body: field.text({ required: true, maxLength: 20_000 }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
			updatedAt: field.timestamp({ column: 'updated_at', auto: 'update' }),
		};
	},
}) {}
