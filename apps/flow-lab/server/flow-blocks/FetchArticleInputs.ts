import { defineBlock } from '@db3.ai/app/flows';

import { DemoContentPlan, DemoUser } from '../models/index.js';
import { requireArticleState, requireObject, requireString, type ArticleStatePort } from './articleState.js';

/** Reads user and content-plan records through explicit app-owned model contracts. */
export default defineBlock<ArticleStatePort, ArticleStatePort>({
	type: 'database.fetch-article-inputs',
	name: 'Fetch User and Plan',
	description: 'Loads the requested user and content plan from Flow Lab models and exposes a JSON-safe snapshot.',
	inputs: {
		state: { type: 'json', required: true },
	},
	outputs: {
		state: { type: 'json', required: true },
	},
	/**
	 * Loads article inputs and verifies their ownership relationship.
	 *
	 * @param input - Pipeline state containing request ids.
	 * @param context - Runtime context used for durable diagnostics.
	 * @returns Pipeline state with fetched database records.
	 */
	async run(input, context) {
		const state = requireArticleState(input);
		const request = requireObject(state.request, 'state.request');
		const userId = requireString(request, 'userId');
		const contentPlanId = requireString(request, 'contentPlanId');
		const user = await DemoUser.findOrFail(userId);
		const contentPlan = await DemoContentPlan.findOrFail(contentPlanId);

		if (contentPlan.userId !== user.id) {
			throw new Error('The requested content plan does not belong to the requested user.');
		}

		const nextState = {
			...state,
			user: {
				id: String(user.id),
				name: String(user.name),
				email: String(user.email),
				company: String(user.company),
				audience: String(user.audience),
			},
			contentPlan: {
				id: String(contentPlan.id),
				targetKeyword: String(contentPlan.targetKeyword),
				plannedDate: String(contentPlan.plannedDate),
				brief: String(contentPlan.brief),
				status: String(contentPlan.status),
			},
		};

		await context.log('info', 'Database records loaded.', {
			userId,
			contentPlanId,
		});

		return { state: nextState };
	},
});
