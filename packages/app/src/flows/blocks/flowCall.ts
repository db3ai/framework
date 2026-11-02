import type { FlowBlockDefinition } from '../contracts';

/** Runs another flow and waits for its outputs. */
export const FLOW_RUN_BLOCK_TYPE = 'flow.run';

/** Starts another flow without waiting. */
export const FLOW_START_BLOCK_TYPE = 'flow.start';

/**
 * Runs the flow named by the step's `flow` and waits. Settings are its inputs; outputs are its outputs.
 * `"sync": { "type": "flow.run", "flow": "crm-sync", "config": { "email": "{{input.email}}" } }`
 */
export const FlowRunBlock: FlowBlockDefinition = {
	type: FLOW_RUN_BLOCK_TYPE,
	kind: 'flow',
	name: 'Run flow',
	description: 'Runs another flow with these inputs and waits for its outputs.',
	inputs: {},
	outputs: {},
};

/** Starts the flow named by the step's `flow` without waiting; outputs `runId`. */
export const FlowStartBlock: FlowBlockDefinition = {
	type: FLOW_START_BLOCK_TYPE,
	kind: 'flow',
	name: 'Start flow',
	description: 'Starts another flow with these inputs and does not wait.',
	inputs: {},
	outputs: { runId: { type: 'string', required: true } },
};
