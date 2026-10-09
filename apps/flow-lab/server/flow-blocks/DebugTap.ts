import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type GreetingValues = FlowValues & {
	greeting: string;
};

/**
 * Records values at a graph boundary without changing them.
 */
export default defineBlock<GreetingValues, GreetingValues>({
	type: 'debug.tap',
	name: 'Debug Tap',
	description: 'Records incoming values in the durable run timeline and passes them through.',
	insertable: true,
	inputs: {
		greeting: {
			type: 'string',
			required: true,
		},
	},
	outputs: {
		greeting: {
			type: 'string',
			required: true,
		},
	},
	/**
	 * Writes the current greeting to the run log and returns it unchanged.
	 *
	 * @param input - Values observed at this graph boundary.
	 * @param context - Durable block logging context.
	 * @returns Original input values.
	 */
	async run(input, context) {
		await context.log('info', 'Debug tap observed the greeting.', input);

		return input;
	},
});
