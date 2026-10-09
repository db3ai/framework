import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, requireString, type ArticleStatePort } from './articleState.js';

/** Simulates tracked generation for every asset in the frozen image plan. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'agent.generate-images',
	name: 'Generate Images',
	description: 'Generates exactly the planned title and body assets while preserving role, kind, alt text, and placement metadata.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Adds deterministic generated URLs to every planned image specification.
	 *
	 * @param input - Pipeline state containing the draft.
	 * @returns Pipeline state with generated image assets.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const imagePlan = state.imagePlan && typeof state.imagePlan === 'object' && !Array.isArray(state.imagePlan)
			? state.imagePlan
			: null;

		if (!imagePlan) throw new Error('Image generation requires state.imagePlan.');

		const assets = objectArray(imagePlan.assets, 'state.imagePlan.assets');
		const images = assets.map<FlowValues>(asset => {
			const key = requireString(asset, 'key');

			return {
				...asset,
				url: `https://images.example.test/article-flow-${key}.webp`,
			};
		});

		await context.log('info', 'Planned article images generated.', {
			count: images.length,
			keys: images.map(image => image.key),
		});

		return {
			state: {
				...state,
				images,
			},
		};
	},
});
