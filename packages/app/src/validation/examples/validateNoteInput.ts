import { validate, type ValidationRuleName } from '@db3.ai/app/validation';

/** Safe, explicitly selected values accepted by the application note workflow. */
export interface NoteInput {
	title: string;
	priority: number;
}

/** Public validation response deliberately omits submitted values and rule details. */
export type NoteInputResult = { valid: true; data: NoteInput } | { valid: false; errors: Array<{ field: string; rule: ValidationRuleName; message: string }> };

/**
 * Validates a note request, then explicitly converts and selects writable fields.
 *
 * Validation does not authorize a writer, remove unknown fields or convert form
 * strings. The application owns those steps; model fields should own conversion
 * instead when the destination is an ActiveRecord model.
 *
 * @param input - Untrusted JSON request body.
 * @returns Safe application data or field errors without submitted values.
 */
export function validateNoteInput(input: unknown): NoteInputResult {
	const result = validate(input, {
		title: ['required', 'string', { rule: 'minLength', value: 1 }, { rule: 'maxLength', value: 120 }, { rule: 'regex', pattern: /\S/, message: 'Enter a title, not only spaces.' }],
		priority: ['required', 'integer', 'min:1', 'max:5'],
	});
	if (!result.valid) {
		return { valid: false, errors: result.errors.map(({ field, rule, message }) => ({ field, rule, message })) };
	}
	return { valid: true, data: { title: String(result.data.title).trim(), priority: Number(result.data.priority) } };
}
