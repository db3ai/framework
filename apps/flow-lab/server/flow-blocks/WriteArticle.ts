import { defineBlock } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, requireObject, requireString, stringArray, type ArticleStatePort } from './articleState.js';

/** Simulates the article-writing agent while preserving its full output boundary. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'agent.write-article',
	name: 'Write Article',
	description: 'Produces a deterministic markdown draft where a tracked article-writing agent will later execute.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Produces markdown with natural anchor phrases and every planned image placeholder.
	 *
	 * @param input - Pipeline state containing an article plan.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with draft content.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const plan = requireObject(state.articlePlan, 'state.articlePlan');
		const imagePlan = requireObject(state.imagePlan, 'state.imagePlan');
		const linkPlan = requireObject(state.linkPlan, 'state.linkPlan');
		const title = requireString(plan, 'title');
		const sections = stringArray(plan.sections);
		const assets = objectArray(imagePlan.assets, 'state.imagePlan.assets');
		const selectedLinks = [
			...objectArray(linkPlan.internal, 'state.linkPlan.internal'),
			...objectArray(linkPlan.external, 'state.linkPlan.external'),
		];
		const titleImage = assets.find(asset => asset.role === 'title');

		if (!titleImage) throw new Error('Article writing requires one planned title image.');

		const paragraphs = [
			`# ${title}`,
			requireString(titleImage, 'placeholder'),
			'Background AI work is easiest to trust when every transition is visible, each expensive decision is reviewable, and the final output can be reconstructed from durable evidence.',
		];

		for (const [index, section] of sections.entries()) {
			paragraphs.push(`## ${section}`);
			paragraphs.push(sectionCopy(index));

			const selectedLink = selectedLinks[index];

			if (selectedLink) {
				paragraphs.push(linkSentence(selectedLink));
			}

			for (const asset of assets.filter(candidate => candidate.role === 'body' && candidate.afterHeading === section)) {
				paragraphs.push(requireString(asset, 'placeholder'));
			}
		}

		const markdown = paragraphs.join('\n\n');

		await context.log('info', 'Draft generated.', {
			title,
			characters: markdown.length,
		});

		return {
			state: {
				...state,
				draft: {
					title,
					markdown,
				},
			},
		};
	},
});

/**
 * Returns deterministic body copy for a planned article section.
 *
 * @param index - Zero-based section position.
 * @returns Editorial paragraph for the section.
 */
function sectionCopy(index: number): string {
	const paragraphs = [
		'An opaque background task may eventually produce an answer, but it does not show which context was loaded, which decision failed, or whether retrying will repeat an expensive side effect. A visible background job lifecycle gives operators a reliable execution foundation.',
		'A flow definition should separate input loading, research, drafting, asset production, review, and persistence. Stable contracts at those boundaries make the work understandable to developers and give agent observability a useful business-level frame.',
		'Captured step inputs, outputs, timing, and logs explain why a result changed. They also keep model-level traces connected to the larger article lifecycle without forcing the queue record to become a permanent workflow ledger.',
		'Safe workflow replay distinguishes historical snapshots from the latest definition. Automatic retries can remain on the failed step, while deliberate replays should state exactly which earlier evidence is being reused.',
		'Production adoption works best when persistence is the final idempotent boundary. The article should not be saved until images, links, placeholders, and editorial limits have passed one explicit validation gate.',
	];

	return paragraphs[index] ?? paragraphs[paragraphs.length - 1];
}

/**
 * Builds prose containing the candidate's natural anchor phrase without linking it yet.
 *
 * @param candidate - Selected internal or external link candidate.
 * @returns Supporting sentence ready for the link-weaving block.
 */
function linkSentence(candidate: ReturnType<typeof requireObject>): string {
	const anchorText = requireString(candidate, 'anchorText');
	const summary = requireString(candidate, 'summary');

	return `For supporting detail, ${anchorText} is a useful next read. ${summary}`;
}
