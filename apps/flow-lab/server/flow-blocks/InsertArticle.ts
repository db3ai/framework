import { defineBlock } from '@db3.ai/app/flows';

import { DemoArticle, DemoContentPlan } from '../models/index.js';
import { objectArray, requireArticleState, requireObject, requireString, stringArray, type ArticleResultPort, type ArticleStatePort } from './articleState.js';

/** Writes the reviewed article through explicit Flow Lab ActiveRecord models. */
export default defineBlock<ArticleStatePort, ArticleResultPort>({
	type: 'database.insert-article',
	name: 'Insert Article',
	description: 'Persists a reviewed article and marks its content-plan item generated.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { result: { type: 'json', required: true } },
	/**
	 * Persists the generated article and updates its source plan.
	 *
	 * @param input - Reviewed pipeline state ready for persistence.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Public article result with persisted identifiers.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const draft = requireObject(state.draft, 'state.draft');
		const review = requireObject(state.review, 'state.review');
		const userId = requireString(request, 'userId');
		const contentPlanId = requireString(request, 'contentPlanId');
		const reviewStatus = requireString(review, 'status');
		const placedImages = objectArray(state.placedImages, 'state.placedImages');
		const insertedLinks = objectArray(state.insertedLinks, 'state.insertedLinks');

		if (reviewStatus !== 'approved') {
			throw new Error('Only finalized and approved articles can be persisted.');
		}

		const article = DemoArticle.create({
			userId,
			contentPlanId,
			title: requireString(draft, 'title'),
			markdown: requireString(draft, 'markdown'),
			images: stringArray(state.imageUrls),
			reviewStatus,
		});

		await article.save();

		const contentPlan = await DemoContentPlan.findOrFail(contentPlanId);

		contentPlan.status = 'generated';
		await contentPlan.save();

		const result = {
			article: {
				id: String(article.id),
				title: String(article.title),
				contentPlanId,
				reviewStatus,
				images: article.images ?? [],
				titleImage: placedImages.find(image => image.role === 'title')?.url ?? null,
				bodyImages: placedImages.filter(image => image.role === 'body').map(image => image.url),
				diagrams: placedImages.filter(image => image.kind === 'diagram' || image.kind === 'infographic').map(image => image.url),
				internalLinks: insertedLinks.filter(link => link.kind === 'internal').map(link => link.url),
				externalLinks: insertedLinks.filter(link => link.kind === 'external').map(link => link.url),
				metrics: review.metrics,
			},
		};

		await context.log('info', 'Article inserted into the database.', result);
		return { result };
	},
});
