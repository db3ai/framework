import { StringField } from '@db3.ai/app/db';

/** Reusable uppercase identifier conversion with normal string validation/storage. */
export class NoteCodeField extends StringField {
	/** Normalizes trusted or request input without duplicating database conversion. */
	protected override parse(input: unknown): string | null {
		return super.parse(input)?.toUpperCase() ?? null;
	}
}
