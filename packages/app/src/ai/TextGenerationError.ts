/** Safe failure classification. Provider bodies and credentials are deliberately omitted. */
export class TextGenerationError extends Error {
	/** Creates a safe application-facing error without retaining provider payloads. */
	constructor(public readonly code: 'configuration' | 'invalid_input' | 'cancelled' | 'timeout' | 'rate_limit' | 'provider' | 'incomplete') {
		super(`Text generation failed (${code}).`);
		this.name = 'TextGenerationError';
	}
}
