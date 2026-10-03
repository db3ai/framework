/** Structured provider refusal; consumers decide retry policy without parsing diagnostic messages. */
export class MailDeliveryError extends Error {
	/** Creates a refusal retaining the provider code, HTTP status and optional validated retry time. */
	constructor(message: string, readonly provider: string, readonly status: number, readonly code: string | null, readonly retryAt: Date | null = null) {
		super(message);
		this.name = 'MailDeliveryError';
	}
}
