import { chunkEmbeddingText, type Ai } from '@db3.ai/app/ai';

/**
 * Prepares source-backed passages before making tracked embedding requests.
 * The application supplies its configured AI service and publishes the returned
 * collection only if the original source revision is still current.
 *
 * @param ai - Application AI service with its provider and allowance policy.
 * @param text - Extracted source text or Markdown, without raw HTML.
 * @param title - Source title repeated as context on every passage.
 * @returns Ordered passages with their vectors, model and request identifiers.
 */
export async function prepareDocumentEmbeddings(ai: Ai, text: string, title: string) {
	const results = [];
	for (const chunk of chunkEmbeddingText(text, { context: `title: ${title}` })) {
		const embedding = await ai.generateEmbedding(chunk.input);
		results.push({ chunk, ...embedding });
	}
	return results;
}
