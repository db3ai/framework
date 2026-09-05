import type * as scheduler from './contracts';
import { ScheduledEvent } from './ScheduledEvent';

/**
 * Fluent daily schedule for one short inline callback.
 */
export class ScheduledCall extends ScheduledEvent {
	readonly kind = 'call' as const;

	/**
	 * Creates a scheduled inline callback.
	 *
	 * @param callback - Short synchronous or asynchronous task.
	 */
	constructor(
		private readonly callback: scheduler.ScheduledCallHandler,
	) {
		super();
	}

	/**
	 * Runs the scheduled callback and awaits asynchronous completion.
	 */
	async run(): Promise<void> {
		await this.callback();
	}

	/**
	 * Requires every callback schedule to declare a stable explicit name.
	 *
	 * @returns Null because anonymous callback identity is not durable.
	 */
	protected override defaultName(): string | null {
		return null;
	}
}
