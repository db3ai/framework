import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';
import { NoteCodeField } from './NoteCodeField';

/** A disposable guide model demonstrating reusable and JSON-backed field values. */
export class FieldNote extends ActiveRecord {
	static override table = 'field_notes';
	static override requestFillable = ['code', 'tags', 'metadata'];

	/** Declares one place for input, validation, storage and public-output policy. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			owner: field.string({ column: 'owner_id', required: true, index: true }),
			code: new NoteCodeField({ required: true, maxLength: 20 }),
			tags: field.stringList({ maxItems: 3, truncate: false }),
			metadata: field.json<{ client: { name: string }; draft: boolean }>(),
			integration: field.encryptedJson<{ token: string }>({ column: 'integration_secret', selectedByDefault: false }),
		};
	}

	declare id: string | null;
	declare owner: string | null;
	declare code: string | null;
	declare tags: string[];
	declare metadata: { client: { name: string }; draft: boolean } | null;
	declare integration: { token: string } | null;
}
