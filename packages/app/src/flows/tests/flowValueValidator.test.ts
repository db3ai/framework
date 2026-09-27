import { describe, expect, it } from 'vitest';
import { cloneFlowValue, isFlowValue, matchesDefinition, validateFlowValues } from '@db3.ai/app/flows';

describe('flow value boundaries', () => {
	it.each([
		['string', 'text', 42],
		['number', 42, '42'],
		['boolean', false, 0],
		['object', { nested: [true, null] }, []],
		['array', [1, 'two'], {}],
		['json', { any: [1, false, null] }, Symbol('invalid')],
	] as const)('accepts declared %s values and rejects incompatible inputs', (type, value, invalid) => {
		expect(matchesDefinition(value, { type })).toBe(true);
		expect(validateFlowValues({ input: value }, { input: { type, required: true } }, 'Block')).toEqual({ input: value });
		expect(matchesDefinition(invalid, { type })).toBe(false);
		expect(() => validateFlowValues({ input: invalid }, { input: { type } }, 'Block')).toThrow(`Block.input must be ${type === 'object' || type === 'array' ? 'an' : 'a'} ${type}.`);
	});

	it('rejects non-object inputs and undeclared fields with useful locations', () => {
		for (const value of [null, [], 'text', undefined]) {
			expect(() => validateFlowValues(value, {}, 'Input')).toThrow('Input must be an object.');
		}
		expect(() => validateFlowValues({ extra: 1 }, {}, 'Input')).toThrow('Input.extra is not declared.');
	});

	it('requires declared mandatory fields and normalizes absent optional fields to null', () => {
		for (const value of [{}, { name: null }]) {
			expect(() => validateFlowValues(value, { name: { type: 'string', required: true } }, 'Input')).toThrow('Input.name is required.');
		}
		expect(validateFlowValues({}, { name: { type: 'string' } }, 'Input')).toEqual({ name: null });
	});

	it('applies detached defaults without mutating schema or input objects', () => {
		const fallback = { values: ['original'] };
		const supplied = { values: ['supplied'] };
		const result = validateFlowValues({ input: supplied }, { input: { type: 'object' }, fallback: { type: 'object', default: fallback } }, 'Block');
		expect(result).toEqual({ input: supplied, fallback });
		expect(result.input).not.toBe(supplied);
		expect(result.fallback).not.toBe(fallback);
		(result.fallback as { values: string[] }).values.push('changed');
		expect(fallback.values).toEqual(['original']);
		expect(cloneFlowValue(supplied)).not.toBe(supplied);
	});

	it('rejects non-finite numbers and non-serializable nested values', () => {
		for (const value of [Infinity, NaN, undefined, BigInt(1), { nested: undefined }, [1, Infinity]]) {
			expect(isFlowValue(value)).toBe(false);
		}
		expect(isFlowValue({ nested: [null, true, 'text', 0] })).toBe(true);
	});
});
