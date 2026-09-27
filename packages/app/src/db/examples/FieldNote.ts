import { ActiveRecord } from '@db3.ai/app/db';
import { NoteCodeField } from './NoteCodeField';

/** A disposable guide model demonstrating reusable and JSON-backed field values. */
export class FieldNote extends ActiveRecord.define({
	table: 'field_notes',
	requestFillable: ['code', 'tags', 'metadata'],

	/** Declares one place for input, validation, storage and public-output policy. */
	fields(field) {
		return {
			id: field.ulid(),
			owner: field.string({ column: 'owner_id', required: true, index: true }),
			code: new NoteCodeField({ required: true, maxLength: 20 }),
			tags: field.stringList({ maxItems: 3, truncate: false }),
			metadata: field.json<{ client: { name: string }; draft: boolean }>(),
			integration: field.encryptedJson<{ token: string }>({ column: 'integration_secret', selectedByDefault: false }),
		};
	},
}) {
}
