import { defineBlock } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Replaces article image placeholders with generated asset markdown. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.place-images',
	name: 'Place Images',
	description: 'Maps generated image assets back into stable placeholders in the article draft.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Replaces every planned placeholder and records placement evidence.
	 *
	 * @param input - Pipeline state containing draft and image assets.
	 * @returns Pipeline state with image-complete markdown.
	 */
	run(input) {
		const state = requireArticleState(input);
		const draft = requireObject(state.draft, 'state.draft');
		const images = objectArray(state.images, 'state.images');
		let markdown = requireString(draft, 'markdown');

		for (const image of images) {
			const placeholder = requireString(image, 'placeholder');
			const alt = requireString(image, 'alt');
			const url = requireString(image, 'url');

			if (!markdown.includes(placeholder)) {
				throw new Error(`Draft does not contain planned image placeholder ${placeholder}.`);
			}

			markdown = markdown.replace(placeholder, `![${alt}](${url})`);
		}

		return {
			state: {
				...state,
				draft: {
					...draft,
					markdown,
				},
				imageUrls: images.map(image => requireString(image, 'url')),
				placedImages: images,
			},
		};
	},
});
