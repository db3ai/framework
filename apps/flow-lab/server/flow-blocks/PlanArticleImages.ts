import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import { requireArticleState, requireBoolean, requireInteger, requireObject, requireString, stringArray, type ArticleStatePort } from './articleState.js';

/** Creates the exact title, body, and diagram asset plan before drafting. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.plan-images',
	name: 'Plan Article Images',
	description: 'Freezes the entitled image count, guarantees one title image, and reserves a body slot for a diagram when configured.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Converts request entitlements and article sections into an explicit asset list.
	 *
	 * @param input - Pipeline state containing the request and article plan.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with an immutable image plan.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const imagePolicy = requireObject(request.imagePolicy, 'state.request.imagePolicy');
		const articlePlan = requireObject(state.articlePlan, 'state.articlePlan');
		const title = requireString(articlePlan, 'title');
		const sections = stringArray(articlePlan.sections);
		const bodyImageCount = requireInteger(imagePolicy, 'bodyImageCount');
		const requireDiagram = requireBoolean(imagePolicy, 'requireDiagram');

		if (sections.length === 0) {
			throw new Error('Article image planning requires at least one article section.');
		}

		const assets: FlowValues[] = [titleAsset(title)];

		for (let index = 0; index < bodyImageCount; index += 1) {
			assets.push(bodyAsset(title, sections[index % sections.length], index, requireDiagram));
		}

		const imagePlan = {
			assets,
			expected: {
				titleImages: 1,
				bodyImages: bodyImageCount,
				totalImages: bodyImageCount + 1,
				minimumDiagrams: requireDiagram ? 1 : 0,
			},
		};

		await context.log('info', 'Article image plan frozen.', imagePlan.expected);
		return { state: { ...state, imagePlan } };
	},
});

/**
 * Creates the mandatory title image specification.
 *
 * @param title - Planned article title.
 * @returns Title-image asset specification.
 */
function titleAsset(title: string): FlowValues {
	return {
		key: 'title',
		role: 'title',
		kind: 'editorial-illustration',
		alt: `${title} title image`,
		prompt: `Editorial title image for "${title}" with a clear focal point and no embedded text.`,
		placeholder: '{{image:title}}',
	};
}

/**
 * Creates one body asset and reserves the first slot for a diagram when required.
 *
 * @param title - Planned article title.
 * @param section - Section receiving the body image.
 * @param index - Zero-based body-image position.
 * @param requireDiagram - Whether the first body asset must be explanatory.
 * @returns Body-image asset specification.
 */
function bodyAsset(title: string, section: string, index: number, requireDiagram: boolean): FlowValues {
	const sequence = index + 1;
	const diagram = requireDiagram && index === 0;

	return {
		key: `body-${sequence}`,
		role: 'body',
		kind: diagram ? 'diagram' : 'editorial-illustration',
		alt: diagram
			? `${title} workflow diagram`
			: `${section} supporting illustration`,
		prompt: diagram
			? `Information diagram explaining the stages in "${title}" for the section "${section}". Use labelled boxes and arrows.`
			: `Supporting editorial illustration for the section "${section}" in "${title}" with no embedded text.`,
		placeholder: `{{image:body-${sequence}}}`,
		afterHeading: section,
	};
}
