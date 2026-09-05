import type { FlowValues } from '../contracts';
import { defineBlock } from '../defineBlock';

/** Stable framework type for the visible public-input boundary node. */
export const FLOW_INPUT_BLOCK_TYPE = 'flow.input';

/**
 * Framework-owned input boundary whose effective ports come from its flow.
 *
 * The fallback `value` port keeps an unspecialized designer node connectable.
 * The compiler replaces it with the source definition's complete input contract.
 */
export const FlowInput = defineBlock<FlowValues, FlowValues>({
	type: FLOW_INPUT_BLOCK_TYPE,
	name: 'Flow Input',
	description: 'Exposes the public flow inputs to blocks inside this definition.',
	inputs: {
		value: { type: 'json', required: true },
	},
	outputs: {
		value: { type: 'json', required: true },
	},
	/**
	 * Passes validated public flow input through its visible output handles.
	 *
	 * @param input - Public flow input validated against the resolved contract.
	 * @returns Unchanged input values.
	 */
	run(input) {
		return input;
	},
});
