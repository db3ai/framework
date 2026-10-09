import { defineBlock } from '@db3.ai/app/flows';

import { DemoWebsitePage } from '../models/index.js';
import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';
import { linkCandidate } from './linkCandidates.js';

/** Finds approved cross-site pages that can participate in backlink exchange. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'search.external-link-candidates',
	name: 'Find External Link Candidates',
	description: 'Ranks relevant pages from other system websites but includes only approved backlink-exchange destinations.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Loads eligible external pages without exposing unapproved exchange targets.
	 *
	 * @param input - Pipeline state containing the normalized article request.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with ranked approved external candidates.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const userId = requireString(request, 'userId');
		const pages = await DemoWebsitePage
			.where('ownerUserId', '!=', userId)
			.where('backlinkExchange', true)
			.orderBy('relevanceScore', 'desc')
			.all();
		const externalLinkCandidates = pages.map(page => linkCandidate(page, 'external'));

		await context.log('info', 'Approved external link candidates ranked.', {
			count: externalLinkCandidates.length,
			candidateIds: externalLinkCandidates.map(candidate => candidate.id),
		});

		return {
			state: {
				...state,
				externalLinkCandidates,
			},
		};
	},
});
