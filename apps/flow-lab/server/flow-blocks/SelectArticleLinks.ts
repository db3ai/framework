import { defineBlock, type FlowValue, type FlowValues } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, type ArticleStatePort } from './articleState.js';

const MAXIMUM_INTERNAL_LINKS = 3;
const MAXIMUM_EXTERNAL_LINKS = 1;
const MINIMUM_RELEVANCE_SCORE = 80;

/** Selects a capped editorial link plan before article drafting begins. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.select-links',
	name: 'Select Article Links',
	description: 'Chooses only strong candidates while enforcing three internal links and one external link at most.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Filters weak candidates and freezes the links the writer may use.
	 *
	 * @param input - Pipeline state containing ranked internal and external pages.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with a capped link plan.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const internal = strongCandidates(state.internalLinkCandidates).slice(0, MAXIMUM_INTERNAL_LINKS);
		const external = strongCandidates(state.externalLinkCandidates).slice(0, MAXIMUM_EXTERNAL_LINKS);
		const linkPlan = {
			internal,
			external,
			limits: {
				internal: MAXIMUM_INTERNAL_LINKS,
				external: MAXIMUM_EXTERNAL_LINKS,
			},
		};

		await context.log('info', 'Article link plan selected.', {
			internal: internal.map(candidate => candidate.url),
			external: external.map(candidate => candidate.url),
		});

		return { state: { ...state, linkPlan } };
	},
});

/**
 * Returns candidates that clear the editorial relevance threshold.
 *
 * @param value - Captured candidate array.
 * @returns Strong candidates in their existing relevance order.
 */
function strongCandidates(value: FlowValue | undefined): FlowValues[] {
	return objectArray(value, 'link candidates').filter(candidate => (
		typeof candidate.relevanceScore === 'number'
		&& candidate.relevanceScore >= MINIMUM_RELEVANCE_SCORE
	));
}
