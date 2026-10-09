import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import { objectArray, requireArticleState, requireBoolean, requireInteger, requireObject, requireString, type ArticleStatePort } from './articleState.js';

const MAXIMUM_INTERNAL_LINKS = 3;
const MAXIMUM_EXTERNAL_LINKS = 1;

/** Applies hard editorial constraints before the article is allowed to persist. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'article.finalize',
	name: 'Finalize Article',
	description: 'Rejects unresolved placeholders, incorrect image or diagram counts, and links outside the editorial caps.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Validates the fully assembled markdown and emits approval metrics.
	 *
	 * @param input - Pipeline state containing final markdown and insertion evidence.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Approved pipeline state ready for persistence.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const imagePolicy = requireObject(request.imagePolicy, 'state.request.imagePolicy');
		const draft = requireObject(state.draft, 'state.draft');
		const markdown = requireString(draft, 'markdown');
		const bodyImageCount = requireInteger(imagePolicy, 'bodyImageCount');
		const requireDiagram = requireBoolean(imagePolicy, 'requireDiagram');
		const placedImages = objectArray(state.placedImages, 'state.placedImages');
		const insertedLinks = objectArray(state.insertedLinks, 'state.insertedLinks');
		const titleImages = placedImages.filter(image => image.role === 'title');
		const bodyImages = placedImages.filter(image => image.role === 'body');
		const diagrams = bodyImages.filter(image => image.kind === 'diagram' || image.kind === 'infographic');
		const internalLinks = insertedLinks.filter(link => link.kind === 'internal');
		const externalLinks = insertedLinks.filter(link => link.kind === 'external');
		const markdownImages = markdownImageUrls(markdown);
		const markdownLinks = markdownLinkUrls(markdown);
		const plannedImageUrls = placedImages.map(image => requireString(image, 'url'));
		const plannedLinkUrls = insertedLinks.map(link => requireString(link, 'url'));
		const violations: string[] = [];

		if (markdown.includes('{{image:')) violations.push('Unresolved image placeholders remain in the article.');
		if (titleImages.length !== 1) violations.push(`Expected exactly one title image; found ${titleImages.length}.`);
		if (bodyImages.length !== bodyImageCount) violations.push(`Expected ${bodyImageCount} body images; found ${bodyImages.length}.`);
		if (requireDiagram && diagrams.length < 1) violations.push('The configured diagram or infographic is missing.');
		if (internalLinks.length > MAXIMUM_INTERNAL_LINKS) violations.push(`Internal links exceed the maximum of ${MAXIMUM_INTERNAL_LINKS}.`);
		if (externalLinks.length > MAXIMUM_EXTERNAL_LINKS) violations.push(`External links exceed the maximum of ${MAXIMUM_EXTERNAL_LINKS}.`);
		if (markdownImages.length !== placedImages.length) violations.push('Markdown image count does not match placed-image evidence.');
		if (markdownLinks.length !== insertedLinks.length) violations.push('Markdown link count does not match inserted-link evidence.');
		if (!titleImagePrecedesBody(markdown, titleImages[0])) violations.push('The title image must appear before the first article section.');

		for (const url of markdownImages) {
			if (!plannedImageUrls.includes(url)) violations.push(`Markdown contains an unplanned image: ${url}`);
		}

		for (const url of markdownLinks) {
			if (!plannedLinkUrls.includes(url)) violations.push(`Markdown contains an unplanned link: ${url}`);
		}

		for (const link of insertedLinks) {
			const anchorText = requireString(link, 'anchorText');
			const url = requireString(link, 'url');

			if (!markdown.includes(`[${anchorText}](${url})`)) {
				violations.push(`Inserted link evidence is missing from markdown: ${url}`);
			}
		}

		if (violations.length > 0) {
			await context.log('error', 'Article finalization failed.', { violations });
			throw new Error(`Article finalization failed: ${violations.join(' ')}`);
		}

		const metrics = {
			titleImages: titleImages.length,
			bodyImages: bodyImages.length,
			diagrams: diagrams.length,
			internalLinks: internalLinks.length,
			externalLinks: externalLinks.length,
		};
		const review = {
			status: 'approved',
			notes: 'Image entitlements, diagram requirements, link caps, placement, and placeholders passed final validation.',
			metrics,
		};

		await context.log('info', 'Article finalized and approved.', metrics);
		return { state: { ...state, review } };
	},
});

/**
 * Checks that the mandatory title image appears before the first level-two heading.
 *
 * @param markdown - Fully assembled article markdown.
 * @param titleImage - Placed title-image evidence.
 * @returns True when title-image placement is valid.
 */
function titleImagePrecedesBody(markdown: string, titleImage: FlowValues | undefined): boolean {
	if (!titleImage) return false;

	const url = requireString(titleImage, 'url');
	const imageIndex = markdown.indexOf(`](${url})`);
	const firstSectionIndex = markdown.indexOf('\n## ');

	return imageIndex >= 0 && (firstSectionIndex < 0 || imageIndex < firstSectionIndex);
}

/**
 * Extracts inline Markdown image destinations from final article copy.
 *
 * @param markdown - Fully assembled article markdown.
 * @returns Image URLs in source order.
 */
function markdownImageUrls(markdown: string): string[] {
	return Array.from(markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g), match => match[1]);
}

/**
 * Extracts non-image Markdown link destinations from final article copy.
 *
 * @param markdown - Fully assembled article markdown.
 * @returns Link URLs in source order.
 */
function markdownLinkUrls(markdown: string): string[] {
	return Array.from(markdown.matchAll(/(^|[^!])\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/gm), match => match[2]);
}
