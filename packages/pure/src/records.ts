/**
 * Checks whether a value is a plain object-like record, excluding arrays and null.
 *
 * @example
 * ```ts
 * isRecord({ message: 'Saved' });
 * // true
 * ```
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns the input as a record, or an empty record when it is not object-like.
 *
 * @example
 * ```ts
 * recordFromUnknown(null);
 * // {}
 * ```
 */
export function recordFromUnknown(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

/**
 * Reads and trims a string field from a record, falling back when it is missing or blank.
 *
 * @example
 * ```ts
 * stringField({ email: ' steve@example.com ' }, 'email');
 * // 'steve@example.com'
 * ```
 */
export function stringField(
	body: Record<string, unknown>,
	field: string,
	fallback = '',
): string {
	const value = body[field];
	const trimmed = typeof value === 'string' ? value.trim() : '';

	return trimmed || fallback;
}

/**
 * Reads a boolean field from a record, falling back when the value is not boolean.
 *
 * @example
 * ```ts
 * booleanField({ includeSubdomains: true }, 'includeSubdomains', false);
 * // true
 * ```
 */
export function booleanField(
	body: Record<string, unknown>,
	field: string,
	fallback: boolean,
): boolean {
	const value = body[field];

	return typeof value === 'boolean' ? value : fallback;
}

/**
 * Reads a finite number field from a record, falling back when it is missing or invalid.
 *
 * @example
 * ```ts
 * numberField({ limit: 25 }, 'limit', 10);
 * // 25
 * ```
 */
export function numberField(
	body: Record<string, unknown>,
	field: string,
	fallback: number,
): number {
	const value = body[field];

	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Returns a non-empty string value, or null for anything else.
 *
 * @example
 * ```ts
 * stringValue('headline');
 * // 'headline'
 * ```
 */
export function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Trims a string-like value, returning the fallback for non-strings.
 *
 * @example
 * ```ts
 * trimmedStringValue('  launch plan  ');
 * // 'launch plan'
 * ```
 */
export function trimmedStringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value.trim() : fallback;
}

/**
 * Converts finite numbers or numeric strings into a number, otherwise null.
 *
 * @example
 * ```ts
 * numberValue('42');
 * // 42
 * ```
 */
export function numberValue(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);

		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

/**
 * Returns an ISO string for Date inputs or a non-empty string as supplied.
 *
 * @example
 * ```ts
 * dateTimeStringValue(new Date('2026-01-01T00:00:00.000Z'));
 * // '2026-01-01T00:00:00.000Z'
 * ```
 */
export function dateTimeStringValue(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string' && value.length > 0) return value;

	return null;
}

/**
 * Reads a nested record field, falling back to an empty record.
 *
 * @example
 * ```ts
 * nestedRecord({ keyword_data: { keyword: 'seo' } }, 'keyword_data');
 * // { keyword: 'seo' }
 * ```
 */
export function nestedRecord(
	value: Record<string, unknown>,
	field: string,
): Record<string, unknown> {
	return recordFromUnknown(value[field]);
}

/**
 * Parses JSON text and requires the result to be an object record.
 *
 * @example
 * ```ts
 * parseJsonRecord('{"job":"crawl"}');
 * // { job: 'crawl' }
 * ```
 */
export function parseJsonRecord(
	input: string,
	message = 'Expected a JSON object.',
): Record<string, unknown> {
	const parsed = JSON.parse(input) as unknown;

	if (!isRecord(parsed)) {
		throw new Error(message);
	}

	return parsed;
}

/**
 * Returns a finite number, or null for missing and non-number values.
 *
 * @example
 * ```ts
 * optionalNumber(12.5);
 * // 12.5
 * ```
 */
export function optionalNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Returns a string that contains non-whitespace characters, preserving the original value.
 *
 * @example
 * ```ts
 * optionalString(' keyword ');
 * // ' keyword '
 * ```
 */
export function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Checks for a promise-like value with a callable `then` method.
 *
 * @example
 * ```ts
 * isPromiseLike(Promise.resolve('done'));
 * // true
 * ```
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === 'object'
		&& value !== null
		&& 'then' in value
		&& typeof (value as PromiseLike<unknown>).then === 'function'
	);
}

/**
 * Checks for a promise value with a callable `finally` method.
 *
 * @example
 * ```ts
 * isFinallyPromise(Promise.resolve('done'));
 * // true
 * ```
 */
export function isFinallyPromise(value: unknown): value is Promise<unknown> {
	return (
		typeof value === 'object'
		&& value !== null
		&& 'finally' in value
		&& typeof (value as Promise<unknown>).finally === 'function'
	);
}
