import type { FlowValueDefinitions, FlowValues } from './FlowValue';

/**
 * Position persisted for a block in compatible graph designers.
 */
export interface FlowBlockPosition {
	/** Horizontal canvas coordinate. */
	x: number;
	/** Vertical canvas coordinate. */
	y: number;
}

/**
 * One configured occurrence of a registered block type inside a flow.
 */
export interface FlowBlockInstance {
	/** Stable ULID for this block occurrence. */
	id: string;
	/** Registered executable block type. */
	type: string;
	/** Optional instance label overriding the block type name in the designer. */
	name?: string;
	/** JSON-safe configuration supplied to the block when it runs. */
	config?: FlowValues;
	/** Designer position stored with the source-of-truth definition. */
	position: FlowBlockPosition;
	/** Optional nested flow id when this instance executes another flow. */
	flowId?: string;
}

/**
 * Serializable input/output contract captured for one resolved block occurrence.
 *
 * Generic subflow and flow-boundary blocks derive their ports from a referenced
 * definition rather than from a statically registered block file. Runs retain
 * this resolved contract so queued steps and replay do not depend on later edits.
 */
export interface FlowResolvedBlockContract {
	/** Named values accepted by the resolved block occurrence. */
	inputs: FlowValueDefinitions;
	/** Named values emitted by the resolved block occurrence. */
	outputs: FlowValueDefinitions;
}

/**
 * One directed value connection between named block ports.
 */
export interface FlowConnection {
	/** Stable ULID for this graph connection. */
	id: string;
	/** Source block occurrence ULID. */
	sourceBlockId: string;
	/** Named output port on the source block. */
	sourcePort: string;
	/** Target block occurrence ULID. */
	targetBlockId: string;
	/** Named input port on the target block. */
	targetPort: string;
}

/**
 * Serializable source-of-truth graph executed by the flow runtime.
 */
export interface FlowDefinition {
	/** Definition schema version used for future compatible migrations. */
	schemaVersion: 1;
	/** Stable ULID used to invoke and reference this flow. */
	id: string;
	/** Human-readable flow name. */
	name: string;
	/** Optional longer explanation for developers and AI tooling. */
	description?: string;
	/** Public input contract accepted when the flow is invoked. */
	inputs: FlowValueDefinitions;
	/** Public output contract returned by the terminal block. */
	outputs: FlowValueDefinitions;
	/** Configured block occurrences in the graph. */
	blocks: FlowBlockInstance[];
	/** Directed connections between block ports. */
	connections: FlowConnection[];
}

/**
 * Immutable execution snapshot produced from one source flow definition.
 *
 * Resolution data is stored only on durable runs. Definition providers continue
 * to read and write the smaller `FlowDefinition` source shape.
 */
export interface FlowExecutionDefinition extends FlowDefinition {
	/** Effective dynamic contracts keyed by block occurrence ULID. */
	resolvedBlocks: Record<string, FlowResolvedBlockContract>;
	/** Immediate child snapshots keyed by flow-backed block occurrence ULID. */
	nestedDefinitions: Record<string, StoredNestedFlowDefinition>;
}

/**
 * Stored child definition captured as part of a parent execution snapshot.
 */
export interface StoredNestedFlowDefinition {
	/** Fully resolved child definition used when the nested block is reached. */
	definition: FlowExecutionDefinition;
	/** Definition-provider revision captured with the child source. */
	revision: string;
	/** Optional provider-relative source path. */
	path?: string;
}

/**
 * Lightweight definition metadata used by flow lists and selectors.
 */
export interface FlowDefinitionSummary {
	/** Stable flow ULID. */
	id: string;
	/** Human-readable flow name. */
	name: string;
	/** Optional developer-facing description. */
	description?: string;
	/** Public input contract exposed when this flow is used as a subflow block. */
	inputs: FlowValueDefinitions;
	/** Public output contract exposed when this flow is used as a subflow block. */
	outputs: FlowValueDefinitions;
	/** Current content revision returned by the definition provider. */
	revision: string;
	/** Provider-relative source path, when one exists. */
	path?: string;
}
