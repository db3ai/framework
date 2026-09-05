import type { FlowValues } from '../contracts';
import { defineBlock } from '../defineBlock';

/** Stable framework type for a definition-backed nested flow block. */
export const SUBFLOW_BLOCK_TYPE = 'flow.subflow';

/**
 * Generic nested-flow placeholder resolved from its referenced definition.
 *
 * The fallback port allows a newly dropped placeholder to be connected before
 * its child definition is created. Once linked, the child contract replaces it.
 */
export const Subflow = defineBlock<FlowValues, FlowValues>({
	type: SUBFLOW_BLOCK_TYPE,
	kind: 'flow',
	name: 'Subflow',
	description: 'Groups a nested flow behind the inputs and outputs declared by its definition.',
	inputs: {
		value: { type: 'json', required: true },
	},
	outputs: {
		value: { type: 'json', required: true },
	},
});
