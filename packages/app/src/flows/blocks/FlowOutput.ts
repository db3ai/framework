import type { FlowValues } from '../contracts';
import { defineBlock } from '../defineBlock';

/** Stable framework type for the visible public-output boundary node. */
export const FLOW_OUTPUT_BLOCK_TYPE = 'flow.output';

/**
 * Framework-owned output boundary whose effective ports come from its flow.
 *
 * Reaching this node terminates the current sequential run and exposes its
 * values through the public contract of the containing flow.
 */
export const FlowOutput = defineBlock<FlowValues, FlowValues>({
	type: FLOW_OUTPUT_BLOCK_TYPE,
	name: 'Flow Output',
	description: 'Terminates the graph and exposes named values to parent flows and callers.',
	inputs: {
		value: { type: 'json', required: true },
	},
	outputs: {
		value: { type: 'json', required: true },
	},
	/**
	 * Passes terminal values through to the public flow result.
	 *
	 * @param input - Values delivered to the output boundary.
	 * @returns Unchanged public output values.
	 */
	run(input) {
		return input;
	},
});
