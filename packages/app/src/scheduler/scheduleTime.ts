const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates and normalizes one daily wall-clock time.
 *
 * @param value - Candidate time in 24-hour HH:mm form.
 * @returns Validated time.
 */
export function normalizeDailyTime(value: string): string {
	const normalized = value.trim();

	if (!DAILY_TIME_PATTERN.test(normalized)) {
		throw new Error(`Invalid daily schedule time "${value}". Use HH:mm in 24-hour time.`);
	}

	return normalized;
}

/**
 * Validates one IANA timezone using the platform Intl implementation.
 *
 * @param value - Candidate IANA timezone.
 * @returns Validated timezone.
 */
export function normalizeScheduleTimezone(value: string): string {
	const normalized = value.trim();

	try {
		new Intl.DateTimeFormat('en-GB', {
			timeZone: normalized,
		}).format(new Date(0));
	} catch {
		throw new Error(`Invalid scheduler timezone "${value}". Use an IANA timezone name.`);
	}

	return normalized;
}

/**
 * Returns whether a UTC instant matches one daily local schedule.
 *
 * @param instant - UTC instant being evaluated.
 * @param time - Local HH:mm schedule time.
 * @param timezone - IANA timezone used for local interpretation.
 * @returns True when the local hour and minute match.
 */
export function dailyScheduleIsDue(
	instant: Date,
	time: string,
	timezone: string,
): boolean {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(instant);
	const hour = parts.find(part => part.type === 'hour')?.value;
	const minute = parts.find(part => part.type === 'minute')?.value;

	return `${hour}:${minute}` === time;
}

/**
 * Floors an instant to its canonical UTC minute.
 *
 * @param instant - Instant to normalize.
 * @returns New Date at second and millisecond zero.
 */
export function utcMinute(instant: Date): Date {
	const time = instant.getTime();

	if (!Number.isFinite(time)) {
		throw new Error('Scheduler requires a valid evaluation date.');
	}

	return new Date(Math.floor(time / 60_000) * 60_000);
}
