/** One stateless text task. Applications own authorization and prompt policy. */
export interface TextRequest {
	/** Untrusted source text, separate from the application instruction. */
	input: string;
	/** Trusted application instruction, never derived from user-controlled roles. */
	instructions: string;
	/** Required upper bound on generated tokens, including reasoning tokens. */
	maxOutputTokens: number;
	/** Optional cancellation signal. Cancellation does not guarantee zero provider cost. */
	signal?: AbortSignal;
}
