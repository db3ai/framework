/** Safe rejection metadata; provider response bodies and credentials are never included. */
export class IntercomDeliveryError extends Error {
	/** Records a failed provider operation without leaking its response body. */
	constructor(readonly operation: string, readonly status: number) {
		super(`Intercom ${operation} failed (${status}).`);
		this.name = 'IntercomDeliveryError';
	}
}
