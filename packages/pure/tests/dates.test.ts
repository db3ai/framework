import { describe, expect, it } from 'vitest';
import { utcDate, validTimeZone, formatInTimeZone, calendarDateInTimeZone, zonedDateTimeToIso } from '../src/dates';

describe('explicit UTC dates and publishing timezones', () => {
	it('reads database dates as UTC and honors explicit offsets', () => {
		expect(utcDate('2026-10-10 13:00:00.123456')?.toISOString()).toBe('2026-10-10T13:00:00.123Z');
		expect(utcDate('2026-10-10T09:00:00-04:00')?.toISOString()).toBe('2026-10-10T13:00:00.000Z');
		expect(utcDate('2026-10-10')?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
	});
	it('rejects invalid, ambiguous and rollover dates', () => {
		for (const value of ['10/11/2026', '2026-02-30', '2026-10-10T24:00:00', 'bad', new Date(NaN)]) expect(utcDate(value)).toBeNull();
	});
	it('formats audience dates across midnight and daylight saving changes', () => {
		expect(calendarDateInTimeZone('2026-10-10T01:00:00Z', 'America/Los_Angeles')).toBe('2026-10-09');
		expect(formatInTimeZone('2026-07-10T13:00:00Z', 'America/New_York', { hour: '2-digit', hourCycle: 'h23' })).toBe('09');
		expect(formatInTimeZone('2026-12-10T13:00:00Z', 'America/New_York', { hour: '2-digit', hourCycle: 'h23' })).toBe('08');
		expect(validTimeZone('Mars/Olympus')).toBeNull();
		expect(() => formatInTimeZone('bad', 'UTC')).toThrow(RangeError);
	});
});

/** Exercises the public string boundary using the real Temporal implementation. */
describe('local scheduling conversion', () => {
	it('resolves local times using seasonal offsets', () => {
		expect(zonedDateTimeToIso('2026-07-10T09:00', 'Europe/London')).toBe('2026-07-10T08:00:00Z');
		expect(zonedDateTimeToIso('2026-12-10T09:00', 'Europe/London')).toBe('2026-12-10T09:00:00Z');
	});
	it('rejects daylight-saving gaps and repeated times unless explicitly resolved', () => {
		expect(() => zonedDateTimeToIso('2026-03-08T02:30', 'America/New_York')).toThrow(RangeError);
		expect(() => zonedDateTimeToIso('2026-11-01T01:30', 'America/New_York')).toThrow(RangeError);
		expect(zonedDateTimeToIso('2026-11-01T01:30', 'America/New_York', 'earlier')).toBe('2026-11-01T05:30:00Z');
		expect(zonedDateTimeToIso('2026-11-01T01:30', 'America/New_York', 'later')).toBe('2026-11-01T06:30:00Z');
	});
	it('rejects invalid local dates, offset inputs and unknown timezones', () => {
		for (const value of ['2026-02-30T09:00', '2026-10-10T24:00', '2026-10-10T09:00Z', '2026-10-10T09:00-04:00', '10/10/2026 09:00']) {
			expect(() => zonedDateTimeToIso(value, 'Europe/London')).toThrow(RangeError);
		}
		expect(() => zonedDateTimeToIso('2026-10-10T09:00', 'Mars/Olympus')).toThrow(RangeError);
	});
});
