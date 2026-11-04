/** Raised when a provider sends nothing for the configured time, so the request appears stuck. */
export class AIProviderTimeoutError extends Error {
	/** Stable code, safe to retain in diagnostics and match in logs. */
	static readonly code = 'ai_provider_inactivity_timeout';
	readonly code = AIProviderTimeoutError.code;

	/**
	 * Creates a failure naming the limit reached; contains no provider text.
	 *
	 * @param timeoutMs - Configured limit in milliseconds.
	 */
	constructor(readonly timeoutMs: number) {
		super(`AI provider sent nothing for ${timeoutMs < 1000 ? `${timeoutMs}ms` : `${Math.round(timeoutMs / 100) / 10}s`}; the request appears stuck.`);
		this.name = 'AIProviderTimeoutError';
	}
}
