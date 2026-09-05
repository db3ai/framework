import type { FlowErrorSnapshot } from './contracts';

/**
 * Converts an unknown thrown value into a JSON-safe durable error snapshot.
 *
 * @param error - Unknown thrown value.
 * @returns Structured error suitable for run and step models.
 */
export function flowErrorSnapshot(error: unknown): FlowErrorSnapshot {
	if (error instanceof Error) {
		return {
			name: error.name || 'Error',
			message: error.message,
			...(error.stack ? { stack: error.stack } : {}),
		};
	}

	return {
		name: 'Error',
		message: String(error),
	};
}
