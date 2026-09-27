/**
 * Raised when an AI operation needs provider credentials but none are configured.
 */
export class AIConfigurationError extends Error {
	/** Creates a missing-provider-configuration error. */
	constructor(message = 'Set OPENAI_API_KEY before using AI features.') {
		super(message);
		this.name = 'AIConfigurationError';
	}
}

/**
 * Raised when the provider rejects a request or returns a payload without text.
 */
export class AIRequestError extends Error {
	/**
	 * Creates a provider request failure.
	 *
	 * @param message - Human-readable provider failure message.
	 * @param code - Stable provider error code, when supplied.
	 */
	constructor(
		message = 'The AI provider did not return a valid response.',
		readonly code: string | null = null,
	) {
		super(message);
		this.name = 'AIRequestError';
	}
}

/**
 * Raised when the application allowance hook rejects an AI request.
 */
export class AIAllowanceExceededError extends Error {
	/** Stable public failure code; applications may specialize it for their own allowance UI. */
	readonly publicCode: string = 'ai_allowance_exceeded';
	/**
	 * Create an allowance failure.
	 *
	 * @param message - Public error message for the denied request.
	 */
	constructor(message = 'AI allowance has been reached for this period.') {
		super(message);
		this.name = 'AIAllowanceExceededError';
	}
}
