import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type NameInput = FlowValues & {
	name: string;
};

type GreetingOutput = FlowValues & {
	greeting: string;
};

type GreetingConfig = FlowValues & {
	prefix: string;
};

/**
 * Builds a configured greeting from the normalized name.
 */
export default defineBlock<NameInput, GreetingOutput, GreetingConfig>({
	type: 'text.build-greeting',
	name: 'Build Greeting',
	description: 'Combines a configured prefix with the incoming name.',
	inputs: {
		name: {
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
	config: {
		prefix: {
			type: 'string',
			required: true,
			default: 'Hello',
			description: 'Text placed before the incoming name.',
		},
	},
	/**
	 * Builds the configured greeting.
	 *
	 * @param input - Normalized name input.
	 * @param context - Runtime context containing validated configuration.
	 * @returns Constructed greeting.
	 */
	run(input, context) {
		return {
			greeting: `${context.config.prefix}, ${input.name}!`,
		};
	},
});
