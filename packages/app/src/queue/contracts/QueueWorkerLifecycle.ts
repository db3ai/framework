/**
 * Minimal logger contract used by queue workers.
 */
export interface QueueLogger {
	/**
	 * Writes an informational queue worker message.
	 *
	 * @param message - Message ready for terminal or log output.
	 */
	info(message: string): void;

	/**
	 * Writes a warning queue worker message.
	 *
	 * @param message - Message ready for terminal or log output.
	 */
	warn?(message: string): void;

	/**
	 * Writes an error queue worker message.
	 *
	 * @param message - Message ready for terminal or log output.
	 */
	error?(message: string): void;
}

/**
 * Runtime controls for a polling queue worker.
 */
export interface QueueWorkerOptions {
	/**
	 * Number of milliseconds between worker ticks.
	 */
	intervalMs?: number;
	/**
	 * Maximum number of jobs to process during each tick.
	 */
	maxJobsPerTick?: number;
	/**
	 * Logger used for lifecycle and job processing messages.
	 */
	logger?: QueueLogger;
	/**
	 * Enables detailed lifecycle logging for idle ticks and queued follow-up work.
	 */
	verbose?: boolean;
	/**
	 * Starts the worker even when QUEUE_WORKER=false or workerEnabled is false.
	 */
	force?: boolean;
}

/**
 * Public lifecycle controls for a long-running queue worker.
 */
export interface QueueWorkerLifecycle {
	/**
	 * Starts polling the configured queue.
	 */
	start(): void;

	/**
	 * Stops future polling ticks without aborting an active tick.
	 */
	stop(): void;

	/**
	 * Stops future polling and resolves after the active tick has completed.
	 */
	stopAndDrain(): Promise<void>;
}
