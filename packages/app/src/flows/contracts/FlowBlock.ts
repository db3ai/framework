import type { FlowBlockInstance } from './FlowDefinition';
import type { FlowValue, FlowValueDefinitions, FlowValues } from './FlowValue';

/**
 * Severity attached to one durable block log entry.
 */
export type FlowLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Execution strategy owned by a registered block type. */
export type FlowBlockKind = 'function' | 'flow';

/**
 * Runtime information and services exposed to an executing block function.
 */
export interface FlowBlockContext<TConfig extends FlowValues = FlowValues> {
	/** Flow definition currently being executed. */
	flowId: string;
	/** Durable run ULID. */
	runId: string;
	/** Durable step-run ULID. */
	stepRunId: string;
	/** Configured block occurrence being executed. */
	block: FlowBlockInstance;
	/** Validated block configuration with defaults applied. */
	config: TConfig;
	/**
	 * Records an ordered durable log entry for this block.
	 *
	 * @param level - Log severity.
	 * @param message - Human-readable log message.
	 * @param data - Optional structured diagnostic data.
	 */
	log(level: FlowLogLevel, message: string, data?: FlowValue): Promise<void>;
}

/**
 * Executable block type registered with a Flows service.
 */
export interface FlowBlockDefinition<
	TInput extends FlowValues = FlowValues,
	TOutput extends FlowValues = FlowValues,
	TConfig extends FlowValues = FlowValues,
> {
	/** Stable namespaced type used by serialized flow definitions. */
	type: string;
	/** Whether this block executes a function or delegates to a nested flow. */
	kind?: FlowBlockKind;
	/** Human-readable block type name. */
	name: string;
	/** Optional explanation shown in block palettes and inspectors. */
	description?: string;
	/** Whether this block safely preserves a value when automatically inserted on a compatible connection. */
	insertable?: boolean;
	/** Named values accepted by the block function. */
	inputs: FlowValueDefinitions;
	/** Named values returned by the block function. */
	outputs: FlowValueDefinitions;
	/** Serializable configuration fields shown in the block inspector. */
	config?: FlowValueDefinitions;
	/**
	 * Executes the block with validated input and runtime context.
	 *
	 * @param input - Values assembled from the flow input or incoming connections.
	 * @param context - Durable run context, configuration, and logging API.
	 * @returns Values emitted through the block output ports.
	 */
	run?(input: TInput, context: FlowBlockContext<TConfig>): TOutput | Promise<TOutput>;
}

/**
 * Designer-safe metadata for one registered executable block type.
 */
export type FlowBlockMetadata = Omit<FlowBlockDefinition, 'run'>;
