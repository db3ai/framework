import { expect, it } from 'vitest';
import { assertValid, validate, ValidationException } from '@db3.ai/app/validation';
import { runNoteValidation } from '../../examples/runNoteValidation';
import { validateNoteInput } from '../../examples/validateNoteInput';

it('rejects bad input, returns safe errors, then explicitly selects and converts a valid note', () => {
	const output = runNoteValidation();
	expect(output.invalid.valid).toBe(false);
	if (!output.invalid.valid) expect(output.invalid.errors).toEqual([{ field: 'title', rule: 'regex', message: 'Enter a title, not only spaces.' }, { field: 'priority', rule: 'max', message: 'priority is invalid' }]);
	expect(output.repaired).toEqual({ valid: true, data: { title: 'First note', priority: 2 } });
	expect(JSON.stringify(output)).not.toMatch(/do-not-return-this|attacker-controlled|password|ownerId/);
	for (const input of [null, [], {}, { title: 1, priority: 1 }, { title: 'x'.repeat(121), priority: 1 }, { title: 'Note', priority: 1.5 }]) expect(validateNoteInput(input).valid).toBe(false);
});

it('demonstrates original-data, presence, length and top-level-only semantics', () => {
	const input = { priority: '2', extra: 'unchanged' };
	const result = validate(input, { priority: ['required', 'integer'] });
	expect(result.data).toBe(input);
	expect(result.data.priority).toBe('2');
	expect(result.data.extra).toBe('unchanged');
	expect(validate({ title: '   ' }, { title: ['required'] }).valid).toBe(true);
	expect(validate({}, { title: ['string'] }).valid).toBe(true);
	expect(validate({ url: '' }, { url: ['nullable', 'url'] }).valid).toBe(true);
	expect(validate({ title: '123' }, { title: ['max:10'] }).valid).toBe(false);
	expect(validate({ title: '123' }, { title: ['maxLength:10'] }).valid).toBe(true);
	expect(validate({ profile: { name: 'Ada' } }, { 'profile.name': ['required'] }).valid).toBe(false);
});

it('supports custom messages and a throwing boundary without claiming type conversion', () => {
	const data = { email: 'ada@example.test' };
	expect(assertValid(data, { email: ['required', 'email'] })).toBe(data);
	expect(() => assertValid({}, { email: ['required'] })).toThrow(ValidationException);
	const result = validate({ email: 'private-invalid-value' }, { email: [{ rule: 'email', message: 'Enter an email address.' }] });
	expect(result.errors[0]).toMatchObject({ message: 'Enter an email address.', value: 'private-invalid-value' });
});
