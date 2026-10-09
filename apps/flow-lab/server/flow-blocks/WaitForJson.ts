import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

import type { ArticleStatePort } from './articleState.js';

type WaitForJsonConfig = FlowValues & {
	milliseconds: number;
};

/** Adds an observable asynchronous delay while preserving a JSON state value. */
export default defineBlock<ArticleStatePort, ArticleStatePort, WaitForJsonConfig>({
	type: 'control.wait-json',
	name: 'Wait for JSON',
	description: 'Pauses a JSON pipeline without changing the value carried by the selected connection.',
	insertable: true,
	inputs: { state: { type: 'json', required: true } },
	outputs: { state: { type: 'json', required: true } },
	config: {
		milliseconds: {
			type: 'number',
			required: true,
			default: 500,
			description: 'Delay in milliseconds.',
		},
	},
	/**
	 * Waits for a bounded delay and returns the original JSON value.
	 *
	 * @param input - JSON state to preserve.
	 * @param context - Runtime context containing configured delay.
	 * @returns Original JSON state after the delay.
	 */
	async run(input, context) {
		const milliseconds = Math.max(0, Math.min(10_000, context.config.milliseconds));

		await new Promise<void>(resolve => setTimeout(resolve, milliseconds));
		return input;
	},
});
