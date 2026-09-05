import { describe, expect, it } from 'vitest';
import {
	assertValid,
	validate,
	ValidationException,
} from '..';

describe('validation', () => {
	it('validates Laravel-style rule lists', () => {
		const result = validate({
			email: 'steve@example.com',
			age: '41',
			name: 'Steve',
			role: 'admin',
			website: 'example.com',
		}, {
			email: ['required', 'email'],
			age: ['integer', 'min:18', 'max:120'],
			name: ['string', { rule: 'maxLength', value: 80 }],
			role: [{ rule: 'in', values: ['admin', 'editor'] }],
			website: ['url'],
		});

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('reports field-level validation failures', () => {
		const result = validate({
			email: 'not-an-email',
			count: '1.5',
			id: 'not-a-ulid',
		}, {
			email: ['required', 'email'],
			count: ['integer'],
			id: ['ulid'],
			optional: ['nullable', 'uuid'],
		});

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([
			expect.objectContaining({ field: 'email', rule: 'email' }),
			expect.objectContaining({ field: 'count', rule: 'integer' }),
			expect.objectContaining({ field: 'id', rule: 'ulid' }),
		]);
	});

	it('can throw a validation exception when requested', () => {
		expect(() => assertValid({
			email: '',
		}, {
			email: ['required', 'email'],
		})).toThrow(ValidationException);
	});
});
