/**
 * Application-owned durable progress for one registered scheduler.
 * Share this checkpoint between replacement processes using the same definitions.
 */
export interface SchedulerCheckpoint {
	/**
	 * Loads the last fully evaluated UTC minute. On first use, atomically persist
	 * and return the minute immediately before firstMinute, establishing the start
	 * of coverage before any scheduled work is attempted.
	 *
	 * @param firstMinute - Current UTC minute at the worker's first startup.
	 * @returns Last evaluated minute, or the newly established starting boundary.
	 */
	load(firstMinute: Date): Promise<Date>;
	/**
	 * Advances progress after all events in a minute have been considered.
	 * Concurrent saves must never move the stored minute backwards. A rejected
	 * save causes the worker to reconsider that minute using occurrence deduplication.
	 *
	 * @param evaluatedFor - UTC minute whose complete evaluation was recorded.
	 */
	save(evaluatedFor: Date): Promise<void>;
}
