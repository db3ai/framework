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
