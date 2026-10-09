import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type GreetingValues = FlowValues & {
	greeting: string;
};

/**
 * Converts the greeting to uppercase.
 */
export default defineBlock<GreetingValues, GreetingValues>({
	type: 'text.uppercase',
	name: 'Uppercase',
	description: 'Converts the incoming greeting to uppercase text.',
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
	 * Converts the greeting to uppercase.
	 *
	 * @param input - Greeting to transform.
	 * @returns Uppercase greeting.
	 */
	run(input) {
		return {
			greeting: input.greeting.toUpperCase(),
		};
	},
});
