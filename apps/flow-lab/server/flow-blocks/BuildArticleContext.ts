import { defineBlock } from '@db3.ai/app/flows';

import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Builds compact model context from fetched user and content-plan data. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.build-context',
	name: 'Build Context',
	description: 'Combines audience, business, brief, and keyword data before research begins.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Builds a deterministic context snapshot for downstream agent blocks.
	 *
	 * @param input - Pipeline state containing fetched records.
	 * @returns Pipeline state with model-ready context.
	 */
	run(input) {
		const state = requireArticleState(input);
		const user = requireObject(state.user, 'state.user');
		const contentPlan = requireObject(state.contentPlan, 'state.contentPlan');

		return {
			state: {
				...state,
				context: {
					company: requireString(user, 'company'),
					audience: requireString(user, 'audience'),
					targetKeyword: requireString(contentPlan, 'targetKeyword'),
					brief: requireString(contentPlan, 'brief'),
					tone: 'Clear, practical, and evidence-led',
				},
			},
		};
	},
});
