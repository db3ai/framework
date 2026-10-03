/**
 * Stops a queue delivery immediately, preserving its failed-job record and hooks.
 * Use for a durable failure that ordinary retries cannot repair. Applications
 * still own partial output and progress; explicit replay remains a separate act.
 */
export class QueueTerminalError extends Error {
	/** Creates an immediately terminal queue failure with a safe explanation. */
	constructor(message: string) {
		super(message);
		this.name = 'QueueTerminalError';
	}
}
