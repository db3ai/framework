import { QueueTerminalError } from './QueueTerminalError';

/** Cooperative stop; lightweight queue deliveries must not automatically retry stopped work. */
export class JobRunStoppedError extends QueueTerminalError {
	/** Captures a durable stop reason without treating expected stops as provider exceptions. */
	constructor(readonly status: 'blocked' | 'cancelled', message: string) {
		super(message);
		this.name = 'JobRunStoppedError';
	}
}
