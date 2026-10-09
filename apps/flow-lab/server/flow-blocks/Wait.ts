import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type GreetingValues = FlowValues & {
	greeting: string;
};

type WaitConfig = FlowValues & {
	milliseconds: number;
};

/**
 * Adds a visible asynchronous boundary to development flows.
 */
export default defineBlock<GreetingValues, GreetingValues, WaitConfig>({
	type: 'control.wait',
	name: 'Wait',
	description: 'Pauses execution briefly so queued progress can be observed in the designer.',
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
	config: {
		milliseconds: {
			type: 'number',
			required: true,
			default: 800,
			description: 'Delay in milliseconds.',
		},
	},
	/**
	 * Waits for the configured delay before returning the input unchanged.
	 *
	 * @param input - Greeting values to preserve.
	 * @param context - Runtime context containing the delay.
	 * @returns Original greeting values after the delay.
	 */
	async run(input, context) {
		const milliseconds = Math.max(0, Math.min(10_000, context.config.milliseconds));

		await new Promise<void>(resolve => {
			setTimeout(resolve, milliseconds);
		});

		return input;
	},
});
