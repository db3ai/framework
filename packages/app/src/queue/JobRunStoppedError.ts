/** Cooperative stop requested by an operator or a job-owned blocking policy. */
export class JobRunStoppedError extends Error {
	/** Captures a durable stop reason without treating expected stops as provider exceptions. */
	constructor(readonly status: 'blocked' | 'cancelled', message: string) {
		super(message);
		this.name = 'JobRunStoppedError';
	}
}
