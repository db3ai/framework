import { defineBlock } from '@db3.ai/app/flows';

import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Simulates the structured article-planning agent boundary. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'agent.article-plan',
	name: 'Generate Article Plan',
	description: 'Turns context and research into a reviewable title, angle, and section outline.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Builds a deterministic article plan from the target keyword.
	 *
	 * @param input - Researched article pipeline state.
	 * @returns Pipeline state with a structured article plan.
	 */
	run(input) {
		const state = requireArticleState(input);
		const context = requireObject(state.context, 'state.context');
		const keyword = requireString(context, 'targetKeyword');

		return {
			state: {
				...state,
				articlePlan: {
					title: 'Observable AI Workflows: A Practical Guide',
					angle: `A practical operating model for ${keyword}.`,
					sections: [
						'Why background AI work becomes opaque',
						'Define durable workflow boundaries',
						'Observe every model and tool transition',
						'Replay without losing historical truth',
						'Put the workflow into production',
					],
				},
			},
		};
	},
});
