/**
 * Named queues a worker may consume. Selection never changes a job's queue.
 * Wildcards discover queues within the configured driver connection/namespace;
 * exclusions always win. Names are exact, with no glob or job-class matching.
 */
export interface QueueSelection {
	/** Exact queue names, or all currently discoverable names. Defaults to the configured default queue. */
	queues?: readonly string[] | '*';
	/** Exact names that this worker must never claim, including when using '*'. */
	excludeQueues?: readonly string[];
	/** Independent in-process polling slots (1–32). Each slot owns its lease and presence; one-shot work still processes one job. */
	concurrency?: number;
	/** Pool polling interval in milliseconds; explicit worker/CLI options override it. */
	intervalMs?: number;
	/** Spreads initial claims across one polling interval, independently for every execution slot. */
	stagger?: boolean;
}
