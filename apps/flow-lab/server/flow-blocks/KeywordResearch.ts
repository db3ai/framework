import { defineBlock } from '@db3.ai/app/flows';

import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Simulates a structured keyword research agent boundary for observability. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'agent.keyword-research',
	name: 'Keyword Research',
	description: 'Produces deterministic research data where a real provider-backed research agent will later run.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Adds representative keyword questions and entities to pipeline state.
	 *
	 * @param input - Pipeline state containing model context.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with keyword research.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const articleContext = requireObject(state.context, 'state.context');
		const keyword = requireString(articleContext, 'targetKeyword');
		const research = {
			primaryKeyword: keyword,
			questions: [
				`What makes ${keyword} reliable?`,
				`How can teams inspect and replay ${keyword}?`,
			],
			entities: ['flow definition', 'run snapshot', 'step boundary', 'replay'],
		};

		await context.log('info', 'Keyword research completed.', research);
		return { state: { ...state, research } };
	},
});
