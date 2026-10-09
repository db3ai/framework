import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Converts the selected link plan into natural inline markdown links. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.weave-links',
	name: 'Weave Links Into Article',
	description: 'Links only phrases already written naturally into the relevant prose and records every insertion.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Replaces the first natural anchor occurrence for each selected candidate.
	 *
	 * @param input - Pipeline state containing placed-image markdown and the link plan.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with linked markdown and insertion evidence.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const draft = requireObject(state.draft, 'state.draft');
		const linkPlan = requireObject(state.linkPlan, 'state.linkPlan');
		const candidates = [
			...objectArray(linkPlan.internal, 'state.linkPlan.internal'),
			...objectArray(linkPlan.external, 'state.linkPlan.external'),
		];
		let markdown = requireString(draft, 'markdown');
		const insertedLinks: FlowValues[] = [];

		for (const candidate of candidates) {
			const anchorText = requireString(candidate, 'anchorText');
			const url = requireString(candidate, 'url');
			const replacement = `[${anchorText}](${url})`;
			const nextMarkdown = replaceFirst(markdown, anchorText, replacement);

			if (nextMarkdown === markdown) {
				await context.log('warning', 'Selected link anchor was not present in the draft.', {
					anchorText,
					url,
				});
				continue;
			}

			markdown = nextMarkdown;
			insertedLinks.push({
				kind: candidate.kind,
				url,
				anchorText,
				source: candidate.source,
			});
		}

		await context.log('info', 'Selected links woven into article copy.', {
			inserted: insertedLinks.length,
			internal: insertedLinks.filter(link => link.kind === 'internal').length,
			external: insertedLinks.filter(link => link.kind === 'external').length,
		});

		return {
			state: {
				...state,
				draft: {
					...draft,
					markdown,
				},
				insertedLinks,
			},
		};
	},
});

/**
 * Replaces the first literal occurrence of a phrase.
 *
 * @param source - Markdown source text.
 * @param search - Natural anchor phrase to locate.
 * @param replacement - Complete markdown link replacement.
 * @returns Updated source, or the original source when the phrase is absent.
 */
function replaceFirst(source: string, search: string, replacement: string): string {
	const index = source.indexOf(search);

	if (index < 0) return source;

	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}
