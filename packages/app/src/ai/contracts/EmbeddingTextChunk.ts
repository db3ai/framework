/** A source-backed passage prepared for the cl100k_base OpenAI embedding models. */
export interface EmbeddingTextChunk {
	/** Zero-based position within this source revision. */
	index: number;
	/** Exact source slice, including any overlap with the preceding chunk. */
	text: string;
	/** Heading hierarchy active at the new source text, excluding preceding overlap. */
	heading: string | null;
	/** Complete provider input, with bounded source context and heading prefix. */
	input: string;
	/** UTF-16 offsets into the original text; end is exclusive. */
	start: number;
	end: number;
	/** Token count of the complete input, including context and overlap. */
	tokens: number;
}

/** Controls deterministic text preparation; callers retain extraction, storage and authorization. */
export interface EmbeddingTextChunkOptions {
	/** Source title, description or other trusted context repeated on every passage. */
	context?: string;
	/** Complete input ceiling, including prefixes. Defaults to 8,000; cannot exceed 8,191. */
	maxTokens?: number;
	/** Maximum preceding text carried into the next passage. Defaults to 128 tokens. */
	overlapTokens?: number;
}
