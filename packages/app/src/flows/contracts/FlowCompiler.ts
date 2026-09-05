import type { FlowBlockDefinition } from './FlowBlock';
import type { FlowBlockInstance, FlowConnection, FlowExecutionDefinition } from './FlowDefinition';

/**
 * Executable block occurrence with its resolved type and graph connections.
 */
export interface CompiledFlowBlock {
	/** Zero-based execution position in the sequential graph. */
	sequence: number;
	/** Configured block occurrence from the source definition. */
	instance: FlowBlockInstance;
	/** Registered executable block type. */
	block: FlowBlockDefinition;
	/** Connections supplying this block's input values. */
	incoming: FlowConnection[];
	/** Connections carrying this block's output values forward. */
	outgoing: FlowConnection[];
}

/**
 * Validated sequential execution plan derived from a flow definition snapshot.
 */
export interface CompiledFlowDefinition {
	/** Definition snapshot used to produce this plan. */
	definition: FlowExecutionDefinition;
	/** Blocks in deterministic execution order. */
	blocks: CompiledFlowBlock[];
	/** Root block receiving the public flow input. */
	root: CompiledFlowBlock;
	/** Terminal block producing the public flow output. */
	terminal: CompiledFlowBlock;
}
