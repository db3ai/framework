import type { FlowValue, FlowValueDefinitions, FlowValues } from './FlowValue';

/**
 * Severity attached to one durable block log entry.
 */
export type FlowLogLevel = 'debug' | 'info' | 'warning' | 'error';

/** Execution strategy owned by a registered block type. */
export type FlowBlockKind = 'function' | 'flow' | 'trigger';

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
	/** The step being run: its name in the flow file, block type and title. */
	step: { name: string; type: string; title?: string };
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
	/** Function action, nested flow, or external source connected to Flow Input. */
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
	 * Named exits. When set, `run` returns `exit(name, values)` and only the edges
	 * leaving through that exit run. Version 2 flows only.
	 */
	exits?: string[];
	/** Exits that depend on a step's settings, such as one per switch case. Wins over `exits`. */
	exitsFor?(config: FlowValues): string[];
	/** Outputs that depend on a step's settings, such as an agent's `returns`. Wins over `outputs`. */
	outputsFor?(config: FlowValues): FlowValueDefinitions;
	/**
	 * Executes the block with validated input and runtime context.
	 *
	 * @param input - Values assembled from the flow input or incoming connections.
	 * @param context - Durable run context, configuration, and logging API.
	 * @returns Values emitted through the block output ports.
	 */
	run?(input: TInput, context: FlowBlockContext<TConfig>): TOutput | FlowExit<TOutput> | Promise<TOutput | FlowExit<TOutput>>;
}

/** Marks a block result that names the exit it takes. */
export const FLOW_EXIT = Symbol.for('db3.flow.exit');

/**
 * Block result naming one of the block's exits, made with `exit(name, values)`.
 */
export interface FlowExit<TOutput extends FlowValues = FlowValues> {
	readonly [FLOW_EXIT]: string;
	/** Output values the step returns. */
	readonly values: TOutput;
}

/**
 * Designer-safe metadata for one registered executable block type.
 */
export type FlowBlockMetadata = Omit<FlowBlockDefinition, 'run' | 'exitsFor' | 'outputsFor'>;
