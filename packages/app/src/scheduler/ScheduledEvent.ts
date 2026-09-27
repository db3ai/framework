import type * as scheduler from './contracts';
import { dailyScheduleIsDue, normalizeDailyTime, normalizeScheduleTimezone } from './scheduleTime';

/**
 * Shared fluent timing configuration for scheduled jobs and calls.
 */
export abstract class ScheduledEvent {
	abstract readonly kind: scheduler.ScheduledTaskKind;
	protected configuredName: string | null = null;
	protected configuredFrequency: scheduler.ScheduleFrequency | null = null;
	protected configuredTimezone = 'UTC';

	/**
	 * Sets the stable identity used for deduplication and history.
	 *
	 * @param name - Stable non-empty schedule name.
	 * @returns This scheduled event.
	 */
	name(name: string): this {
		const normalized = name.trim();

		if (!normalized) {
			throw new Error('Scheduled event names cannot be empty.');
		}

		if (normalized.length > 255) {
			throw new Error('Scheduled event names cannot exceed 255 characters.');
		}

		this.configuredName = normalized;

		return this;
	}

	/** Schedules one occurrence for each evaluated UTC minute, independent of timezone. */
	everyMinute(): this {
		this.configuredFrequency = { type: 'minute' };
		return this;
	}

	/** Schedules one occurrence at minute zero of each UTC hour, independent of timezone. */
	hourly(): this {
		this.configuredFrequency = { type: 'hourly' };
		return this;
	}

	/**
	 * Schedules this task every day at local midnight.
	 *
	 * @returns This scheduled event.
	 */
	daily(): this {
		return this.dailyAt('00:00');
	}

	/**
	 * Schedules this task every day at one local wall-clock time.
	 *
	 * @param time - Time in 24-hour HH:mm form.
	 * @returns This scheduled event.
	 */
	dailyAt(time: string): this {
		this.configuredFrequency = {
			type: 'daily',
			time: normalizeDailyTime(time),
		};

		return this;
	}

	/**
	 * Sets the IANA timezone used to interpret this event's local time.
	 *
	 * @param timezone - IANA timezone such as Europe/London.
	 * @returns This scheduled event.
	 */
	timezone(timezone: string): this {
		this.configuredTimezone = normalizeScheduleTimezone(timezone);

		return this;
	}

	/**
	 * Returns whether this event is due at one canonical UTC minute.
	 *
	 * @param instant - UTC minute being evaluated.
	 * @returns True when the configured frequency matches a valid minute.
	 */
	isDue(instant: Date): boolean {
		const frequency = this.frequency();

		if (frequency.type === 'minute') return Number.isFinite(instant.getTime());
		if (frequency.type === 'hourly') return Number.isFinite(instant.getTime()) && instant.getUTCMinutes() === 0;

		return dailyScheduleIsDue(
			instant,
			frequency.time,
			this.configuredTimezone,
		);
	}

	/**
	 * Returns the normalized public schedule definition.
	 *
	 * @returns Validated schedule definition.
	 */
	definition(): scheduler.ScheduledTaskDefinition {
		const jobName = this.resolvedJobName();

		return {
			name: this.resolvedName(),
			kind: this.kind,
			frequency: this.frequency(),
			timezone: this.configuredTimezone,
			...(jobName ? {
				jobName,
			} : {}),
		};
	}

	/**
	 * Resolves the stable event name or throws when one is unavailable.
	 *
	 * @returns Stable event name.
	 */
	protected resolvedName(): string {
		const name = this.configuredName ?? this.defaultName();

		if (!name) {
			throw new Error(`${this.constructor.name} requires an explicit stable name.`);
		}

		return name;
	}

	/**
	 * Returns the frequency or throws when none was configured.
	 *
	 * @returns Configured frequency.
	 */
	private frequency(): scheduler.ScheduleFrequency {
		if (!this.configuredFrequency) {
			throw new Error(`Scheduled event "${this.resolvedName()}" requires a frequency.`);
		}

		return this.configuredFrequency;
	}

	/**
	 * Returns the default stable name supplied by the concrete event type.
	 *
	 * @returns Default name, or null when explicit naming is required.
	 */
	protected abstract defaultName(): string | null;

	/**
	 * Returns the known queue job name for public schedule inspection.
	 *
	 * @returns Queue job name, or null for calls and deferred factories.
	 */
	protected resolvedJobName(): string | null {
		return null;
	}
}
