const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;
const APPROXIMATE_WORDS_PER_TOKEN = 0.75;

/**
 * Estimates provider tokens from source text before exact usage is available.
 *
 * Character length is preferable to visible word count when the full provider
 * input is available because markup, JSON, and punctuation also consume tokens.
 *
 * @param value - Complete text that will be sent to the provider.
 * @returns Conservative non-zero token estimate.
 *
 * @example
 * const inputTokens = estimateTokensFromText(`${instructions}\n${prompt}`);
 */
export function estimateTokensFromText(value: string): number {
	return Math.max(1, Math.ceil(value.length / APPROXIMATE_CHARACTERS_PER_TOKEN));
}

/**
 * Estimates provider tokens when only a word count is available.
 *
 * The estimate assumes approximately 0.75 English words per token. Callers
 * with the complete source text should use `estimateTokensFromText(...)`.
 *
 * @param wordCount - Number of words in the source content.
 * @returns Approximate token count, or zero for an invalid/non-positive count.
 *
 * @example
 * const inputTokens = estimateTokensFromWords(article.wordCount);
 */
export function estimateTokensFromWords(wordCount: number): number {
	if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;

	return Math.ceil(wordCount / APPROXIMATE_WORDS_PER_TOKEN);
}
