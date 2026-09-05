/** Server-owned configuration for a stateless OpenAI text client. */
export interface OpenAITextOptions {
	/** Developer-supplied secret. Never expose this option to browser code. */
	apiKey: string;
	/** Explicit Responses-compatible model selected by the application. */
	model: string;
	/** Maximum time for one provider request; defaults to 30 seconds. */
	timeoutMs?: number;
	/** External HTTP transport override, primarily for deterministic provider tests. */
	fetch?: typeof globalThis.fetch;
}
