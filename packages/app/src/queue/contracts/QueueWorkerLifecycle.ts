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
 * Runtime controls for a queue worker with backend-owned idle waiting.
 */
export interface QueueWorkerOptions {
	/**
	 * SQL polling delay and transport-error backoff in milliseconds.
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
	 * Starts consuming the configured queue, waiting through its backend when idle.
	 */
	start(): void;

	/**
	 * Stops claiming further work without aborting the current job.
	 */
	stop(): void;

	/**
	 * Stops claiming further work and resolves after the current job has completed.
	 */
	stopAndDrain(): Promise<void>;
}
