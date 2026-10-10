import { Temporal } from './temporal';

/**
 * Converts a Date or parseable date string to an ISO timestamp.
 *
 * @example
 * ```ts
 * isoDate('2026-01-01T00:00:00Z');
 * // '2026-01-01T00:00:00.000Z'
 * ```
 */
export function isoDate(value: Date | string | null | undefined): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();

	const date = new Date(value);

	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Adds whole calendar days to a date.
 *
 * @example
 * ```ts
 * addDays(new Date('2026-01-01T12:00:00Z'), 1).getDate();
 * // 2
 * ```
 */
export function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Formats a Date as YYYY-MM-DD in local calendar time.
 *
 * @example
 * ```ts
 * formatDate(new Date(2026, 0, 5));
 * // '2026-01-05'
 * ```
 */
export function formatDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Converts a numeric or numeric-string id to a finite number.
 *
 * @example
 * ```ts
 * numericId('42');
 * // 42
 * ```
 */
export function numericId(value: number | string | null | undefined): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;

	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);

		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

/**
 * Parses an ISO instant or a database UTC datetime without consulting the host timezone.
 * Offset-free ISO/SQL datetimes are UTC by contract; human locale strings are rejected.
 * Invalid values return null. Database microseconds are truncated to JS milliseconds.
 */
export function utcDate(value: Date | string | null | undefined): Date | null {
	if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
	if (typeof value !== 'string') return null;
	const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:[0-5]\d)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
	if (!match) return null;
	try {
		const instant = Temporal.Instant.from(`${match[1]}T${match[2] ?? '00:00:00'}.${(match[3] ?? '').padEnd(3, '0').slice(0, 3)}${match[4] ?? 'Z'}`);
		return new Date(instant.epochMilliseconds);
	} catch {
		return null;
	}
}

/** Validates and canonicalizes an IANA timezone; invalid or offset-only input returns null. */
export function validTimeZone(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim() || /^[+-]/.test(value.trim())) return null;
	try {
		return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

/**
 * Formats an instant in an explicitly selected timezone, never the host default.
 * Invalid dates or timezones throw RangeError rather than displaying a misleading date.
 */
export function formatInTimeZone(value: Date | string, timeZone: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }, locale = 'en-GB'): string {
	const date = utcDate(value);
	if (!date || !validTimeZone(timeZone)) throw new RangeError('A valid instant and IANA timezone are required.');
	return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
}

/** Returns an ISO calendar day for an instant in the specified IANA timezone. */
export function calendarDateInTimeZone(value: Date | string, timeZone: string): string {
	const date = utcDate(value);
	if (!date || !validTimeZone(timeZone)) throw new RangeError('A valid instant and IANA timezone are required.');
	return Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** Policy for missing or repeated local clock times during daylight-saving transitions. */
export type TimeDisambiguation = 'reject' | 'earlier' | 'later' | 'compatible';

/**
 * Resolves an ISO local date/time in a named timezone to an ISO UTC instant.
 * Offset-bearing inputs are rejected: use utcDate for already resolved instants.
 * Missing or repeated clock times throw RangeError by default; callers must explicitly
 * select another policy if their workflow permits adjustment or choosing an occurrence.
 *
 * @example zonedDateTimeToIso('2026-10-10T09:00', 'Europe/London') // '2026-10-10T08:00:00Z'
 */
export function zonedDateTimeToIso(localDateTime: string, timeZone: string, disambiguation: TimeDisambiguation = 'reject'): string {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,9})?)?$/.test(localDateTime) || !validTimeZone(timeZone)) {
		throw new RangeError('An ISO local date/time and named timezone are required.');
	}
	return Temporal.PlainDateTime.from(localDateTime, { overflow: 'reject' }).toZonedDateTime(timeZone, { disambiguation }).toInstant().toString();
}
