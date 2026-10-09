import { defineBlock } from '@db3.ai/app/flows';

import { requireArticleState, type ArticleStatePort } from './articleState.js';

/** Records the complete evolving JSON state without transforming it. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'debug.state-tap',
	name: 'Observe State',
	description: 'A passive listener block that records the current pipeline state for debugging.',
	insertable: true,
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Logs and returns the current pipeline state unchanged.
	 *
	 * @param input - Pipeline state to observe.
	 * @param context - Runtime context used for durable logging.
	 * @returns Original pipeline state.
	 */
	async run(input, context) {
		const state = requireArticleState(input);

		await context.log('info', 'Article pipeline state observed.', state);
		return { state };
	},
});
