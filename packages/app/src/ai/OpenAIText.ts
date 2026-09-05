import OpenAI from 'openai';
import type * as ai from './contracts';
import { TextGenerationError } from './TextGenerationError';

/** Stateless, server-only text generation. No automatic retries or application billing policy. */
export class OpenAIText {
	readonly #client: OpenAI;
	readonly #model: string;

	/** Creates a client with explicit credentials and bounded, non-retrying requests. */
	constructor(options: ai.OpenAITextOptions) {
		if (!options.apiKey.trim() || !options.model.trim() || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))) {
			throw new TextGenerationError('configuration');
		}
		this.#model = options.model;
		this.#client = new OpenAI({ apiKey: options.apiKey, baseURL: 'https://api.openai.com/v1', timeout: options.timeoutMs ?? 30_000, maxRetries: 0, fetch: options.fetch });
	}

	/**
	 * Runs one bounded text task. Partial, refused and empty responses are not success.
	 *
	 * @param request - Trusted instructions and untrusted input for this task.
	 * @returns Completed text with provider-reported usage.
	 * @example
	 * const result = await ai.generate({ instructions: 'Summarise this note.', input: note.body, maxOutputTokens: 400 });
	 */
	async generate(request: ai.TextRequest): Promise<ai.TextResult> {
		if (!request.input.trim() || !request.instructions.trim() || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 16 || request.maxOutputTokens > 32_768) {
			throw new TextGenerationError('invalid_input');
		}
		try {
			const response = await this.#client.responses.create({
				model: this.#model,
				instructions: request.instructions,
				input: request.input,
				max_output_tokens: request.maxOutputTokens,
				store: false,
			}, { signal: request.signal });
			const refused = response.output.some(item => item.type === 'message' && item.content.some(content => content.type === 'refusal'));
			if (response.status !== 'completed' || refused || !response.output_text?.trim()) throw new TextGenerationError('incomplete');
			return {
				id: response.id,
				model: response.model,
				text: response.output_text,
				usage: response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens } : null,
			};
		} catch (error) {
			if (error instanceof TextGenerationError) throw error;
			if (error instanceof OpenAI.APIUserAbortError) throw new TextGenerationError('cancelled');
			if (error instanceof OpenAI.APIConnectionTimeoutError) throw new TextGenerationError('timeout');
			if (error instanceof OpenAI.RateLimitError) throw new TextGenerationError('rate_limit');
			throw new TextGenerationError('provider');
		}
	}
}
