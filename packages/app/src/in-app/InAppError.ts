/** Stable service errors that HTTP adapters may translate without exposing storage details. */
export class InAppError extends Error {
	/** Creates a validation, access, missing-item or conflicting-retry error. */
	constructor(readonly code: 'invalid' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict', message: string) {
		super(message);
		this.name = 'InAppError';
	}
}
