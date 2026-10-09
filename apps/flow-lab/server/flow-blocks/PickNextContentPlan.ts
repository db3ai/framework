import { defineBlock } from '@db3.ai/app/flows';

import { DEMO_USER_ID } from '../demoData.js';
import { DemoContentPlan } from '../models/index.js';
import { requireArticleState, type ArticleRequestPort, type ArticleStatePort } from './articleState.js';

/** Selects the next planned article and converts it into an article request. */
export default defineBlock<ArticleStatePort, ArticleRequestPort>({
	type: 'database.pick-next-content-plan',
	name: 'Pick Next Article',
	description: 'Selects the earliest planned content item for article generation.',
	inputs: { state: { type: 'json', required: true } },
	outputs: { request: { type: 'json', required: true } },
	/**
	 * Loads the next planned content item for the seeded demo user.
	 *
	 * @param input - Daily state retained for validation and observability.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Article request for the nested generation flow.
	 */
	async run(input, context) {
		requireArticleState(input);

		const contentPlan = await DemoContentPlan
			.where('userId', DEMO_USER_ID)
			.where('status', 'planned')
			.orderBy('plannedDate', 'asc')
			.first();

		if (!contentPlan?.id) {
			throw new Error('No planned content item is available for article generation.');
		}

		const request = {
			userId: DEMO_USER_ID,
			contentPlanId: String(contentPlan.id),
		};

		await context.log('info', 'Next article selected.', {
			...request,
			targetKeyword: String(contentPlan.targetKeyword),
		});

		return { request };
	},
});
