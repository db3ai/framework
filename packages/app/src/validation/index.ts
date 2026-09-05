import { isUlid } from '@db3.ai/pure/ulid';

export type ValidationRuleName =
	| 'required'
	| 'nullable'
	| 'string'
	| 'number'
	| 'integer'
	| 'boolean'
	| 'email'
	| 'url'
	| 'array'
	| 'object'
	| 'min'
	| 'max'
	| 'minLength'
	| 'maxLength'
	| 'in'
	| 'regex'
	| 'ulid'
	| 'uuid';

export type ValidationRule =
	| ValidationRuleName
	| `${ValidationRuleName}:${string}`
	| {
		rule: ValidationRuleName;
		value?: unknown;
		values?: readonly unknown[];
		pattern?: RegExp;
		message?: string;
	};

export type ValidationRules = Record<string, readonly ValidationRule[]>;


export interface ValidationFailure {
	field: string;
	rule: ValidationRuleName;
	message: string;
	value?: unknown;
	details?: Record<string, unknown>;
}

export interface ValidationResult<TData extends Record<string, unknown> = Record<string, unknown>> {
	valid: boolean;
	data: TData;
	errors: ValidationFailure[];
}

export class ValidationException extends Error {
	constructor(public readonly errors: ValidationFailure[]) {
		super('Validation failed');
		this.name = 'ValidationException';
	}
}

export function validate<TData extends Record<string, unknown> = Record<string, unknown>>(
	data: unknown,
	rules: ValidationRules,
): ValidationResult<TData> {
	const input = isPlainRecord(data) ? data : {};
	const errors: ValidationFailure[] = [];

	for (const [field, fieldRules] of Object.entries(rules)) {
		const value = input[field];
		const present = Object.prototype.hasOwnProperty.call(input, field);
		const normalizedRules = fieldRules.map(normalizeRule);
		const nullable = normalizedRules.some(rule => rule.name === 'nullable');

		for (const rule of normalizedRules) {
			if (rule.name === 'nullable') continue;

			if (rule.name === 'required') {
				if (!present || isEmpty(value)) {
					errors.push(failure(field, rule, value));
				}

				continue;
			}

			if (!present || value === undefined || value === null || (nullable && value === '')) {
				continue;
			}

			if (!passesRule(value, rule)) {
				errors.push(failure(field, rule, value));
			}
		}
	}

	return {
		valid: errors.length === 0,
		data: input as TData,
		errors,
	};
}

export function assertValid<TData extends Record<string, unknown> = Record<string, unknown>>(
	data: unknown,
	rules: ValidationRules,
): TData {
	const result = validate<TData>(data, rules);

	if (!result.valid) {
		throw new ValidationException(result.errors);
	}

	return result.data;
}

interface NormalizedRule {
	name: ValidationRuleName;
	value?: unknown;
	values?: readonly unknown[];
	pattern?: RegExp;
	message?: string;
}

function normalizeRule(rule: ValidationRule): NormalizedRule {
	if (typeof rule === 'object') {
		return {
			name: rule.rule,
			value: rule.value,
			values: rule.values,
			pattern: rule.pattern,
			message: rule.message,
		};
	}

	const [name, ...parts] = rule.split(':');
	const value = parts.join(':');

	if (!isRuleName(name)) {
		throw new Error(`Unknown validation rule "${name}"`);
	}

	if (name === 'regex') {
		return {
			name,
			pattern: regexFromString(value),
		};
	}

	if (name === 'in') {
		return {
			name,
			values: value.split(',').map(item => item.trim()),
		};
	}

	return {
		name,
		value: value === '' ? undefined : value,
	};
}

function passesRule(value: unknown, rule: NormalizedRule): boolean {
	switch (rule.name) {
		case 'required':
		case 'nullable':
			return true;

		case 'string':
			return typeof value === 'string';

		case 'number':
			return isNumberLike(value);

		case 'integer':
			return isIntegerLike(value);

		case 'boolean':
			return isBooleanLike(value);

		case 'email':
			return isEmail(value);

		case 'url':
			return isUrlLike(value);

		case 'array':
			return Array.isArray(value);

		case 'object':
			return isPlainRecord(value);

		case 'min':
			return compareSizedValue(value, rule.value, (actual, expected) => actual >= expected);

		case 'max':
			return compareSizedValue(value, rule.value, (actual, expected) => actual <= expected);

		case 'minLength':
			return compareLength(value, rule.value, (actual, expected) => actual >= expected);

		case 'maxLength':
			return compareLength(value, rule.value, (actual, expected) => actual <= expected);

		case 'in':
			return Boolean(rule.values?.some(item => Object.is(item, value) || String(item) === String(value)));

		case 'regex':
			return typeof value === 'string' && Boolean(rule.pattern?.test(value));

		case 'ulid':
			return isUlid(value);

		case 'uuid':
			return typeof value === 'string'
				&& /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
	}
}

function failure(field: string, rule: NormalizedRule, value: unknown): ValidationFailure {
	return {
		field,
		rule: rule.name,
		message: rule.message ?? defaultMessage(field, rule),
		value,
		details: detailsForRule(rule),
	};
}

function defaultMessage(field: string, rule: NormalizedRule): string {
	switch (rule.name) {
		case 'required':
			return `${field} is required`;

		case 'email':
			return `${field} must be a valid email address`;

		case 'url':
			return `${field} must be a valid URL`;

		case 'in':
			return `${field} must be one of the allowed values`;

		default:
			return `${field} is invalid`;
	}
}

function detailsForRule(rule: NormalizedRule): Record<string, unknown> | undefined {
	if (rule.value !== undefined) {
		return { value: rule.value };
	}

	if (rule.values) {
		return { values: rule.values };
	}

	if (rule.pattern) {
		return { pattern: String(rule.pattern) };
	}

	return undefined;
}

function compareSizedValue(
	value: unknown,
	expectedInput: unknown,
	compare: (actual: number, expected: number) => boolean,
): boolean {
	const expected = numberFromUnknown(expectedInput);

	if (expected === null) return false;

	const actual = numberFromUnknown(value);

	if (actual !== null) {
		return compare(actual, expected);
	}

	if (typeof value === 'string' || Array.isArray(value)) {
		return compare(value.length, expected);
	}

	return false;
}

function compareLength(
	value: unknown,
	expectedInput: unknown,
	compare: (actual: number, expected: number) => boolean,
): boolean {
	const expected = numberFromUnknown(expectedInput);

	if (expected === null) return false;

	if (typeof value === 'string' || Array.isArray(value)) {
		return compare(value.length, expected);
	}

	return false;
}

function isNumberLike(value: unknown): boolean {
	return numberFromUnknown(value) !== null;
}

function isIntegerLike(value: unknown): boolean {
	const number = numberFromUnknown(value);

	return number !== null && Number.isInteger(number);
}

function numberFromUnknown(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value !== 'string' || !value.trim()) {
		return null;
	}

	const number = Number(value.trim());

	return Number.isFinite(number) ? number : null;
}

function isBooleanLike(value: unknown): boolean {
	if (typeof value === 'boolean') return true;
	if (typeof value === 'number') return value === 0 || value === 1;

	if (typeof value !== 'string') return false;

	return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(
		value.trim().toLowerCase(),
	);
}

function isUrlLike(value: unknown): boolean {
	if (typeof value !== 'string' || !value.trim()) return false;

	const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
		? value
		: `https://${value}`;

	try {
		const url = new URL(candidate);

		return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.');
	} catch {
		return false;
	}
}

export function isEmail(value: unknown): boolean {
	const EMAIL_REGEX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
	return typeof value === 'string'
		&& value.length <= 254
		&& EMAIL_REGEX.test(value);

}

function regexFromString(value: string): RegExp {
	const match = value.match(/^\/(.*)\/([dgimsuvy]*)$/);

	return match ? new RegExp(match[1], match[2]) : new RegExp(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& !(value instanceof Date);
}

function isEmpty(value: unknown): boolean {
	return value === null
		|| value === undefined
		|| value === ''
		|| (Array.isArray(value) && value.length === 0);
}

function isRuleName(value: string): value is ValidationRuleName {
	return [
		'required',
		'nullable',
		'string',
		'number',
		'integer',
		'boolean',
		'email',
		'url',
		'array',
		'object',
		'min',
		'max',
		'minLength',
		'maxLength',
		'in',
		'regex',
		'ulid',
		'uuid',
	].includes(value);
}
