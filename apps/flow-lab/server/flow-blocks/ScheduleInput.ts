import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import type { ArticleStatePort } from './articleState.js';

type ScheduleValues = FlowValues & {
	date: string;
};

/** Initializes manually triggered daily planning state from an ISO date. */
export default defineBlock<ScheduleValues, ArticleStatePort>({
	type: 'trigger.daily-schedule',
	name: 'Daily Schedule',
	description: 'Represents the daily scheduler trigger while remaining manually runnable in Flow Lab.',
	inputs: {
		date: {
			type: 'string',
			required: true,
		},
	},
	outputs: { state: { type: 'json', required: true } },
	/**
	 * Creates planning state from the scheduled date.
	 *
	 * @param input - Scheduled ISO date.
	 * @returns Initial daily planning state.
	 */
	run(input) {
		return {
			state: {
				date: input.date,
			},
		};
	},
});
