import { defineBlock } from '@db3.ai/app/flows';

import { DemoWebsitePage } from '../models/index.js';
import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';
import { linkCandidate } from './linkCandidates.js';

/** Finds relevant pages owned by the website receiving the generated article. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'search.internal-link-candidates',
	name: 'Find Internal Link Candidates',
	description: 'Searches indexed pages owned by the current website and ranks natural internal-link opportunities.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Loads and ranks internal pages for later editorial selection.
	 *
	 * @param input - Pipeline state containing the normalized article request.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with ranked internal candidates.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const userId = requireString(request, 'userId');
		const pages = await DemoWebsitePage
			.where('ownerUserId', userId)
			.orderBy('relevanceScore', 'desc')
			.all();
		const internalLinkCandidates = pages.map(page => linkCandidate(page, 'internal'));

		await context.log('info', 'Internal link candidates ranked.', {
			count: internalLinkCandidates.length,
			candidateIds: internalLinkCandidates.map(candidate => candidate.id),
		});

		return {
			state: {
				...state,
				internalLinkCandidates,
			},
		};
	},
});
