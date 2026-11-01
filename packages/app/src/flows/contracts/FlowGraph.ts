import type { FlowDefinition } from './FlowDefinition';
import type { FlowValueDefinition, FlowValueDefinitions, FlowValues } from './FlowValue';

/**
 * One way into a flow, switched on by naming it in the flow file.
 *
 * The host that owns the trigger (webhook route, hosted form, scheduler) checks
 * its own credentials and limits, then starts the flow with named input values.
 */
export interface FlowGraphTrigger {
	/** Registered trigger type such as `trigger.webhook`, `trigger.form` or `trigger.schedule`. */
	type: string;
	/** Settings for the trigger host. Never holds secrets. */
	config?: FlowValues;
}

/**
 * One step of a flow: a registered block type plus its settings.
 *
 * Setting values may hold `{{input.x}}`, `{{step.x}}` and `{{env.X}}` references,
 * and `{ "secret": "NAME" }` for values read from the environment at run time.
 */
export interface FlowGraphStep {
	/** Registered block type. */
	type: string;
	/** Label shown on the canvas; defaults to the block type's name. */
	title?: string;
	/** Block inputs and settings, with references resolved just before the step runs. */
	config?: FlowValues;
	/** Another flow, by name, for flow-backed blocks such as `flow.run`. */
	flow?: string;
	/** Parts attached to the step, such as an agent's model, memory or tools. */
	attach?: FlowValues;
}

/**
 * A public output of a flow: its contract plus the value it takes when the run ends.
 */
export interface FlowGraphOutputDefinition extends FlowValueDefinition {
	/** Value or `{{reference}}` read when the run completes. */
	value?: FlowValues[string];
}

/**
 * One edge: `[from, to]`. `from` is `input`, a step name, or `step.exit`.
 */
export type FlowGraphEdge = [from: string, to: string];

/**
 * Flow file shape version 2: named steps, references for values, and edges for order.
 *
 * Steps are keyed by readable names that references, diffs and run history use.
 * Edges say only what runs after what; values move by reference. A step with
 * named exits runs only the edges leaving through the exit it takes.
 */
export interface FlowGraphDefinition {
	/** File shape version. */
	schemaVersion: 2;
	/** Stable ULID, so run history and trigger URLs survive a rename. */
	id: string;
	/** Lower-case name with dashes, used by `flows.start(name)` and other flows. */
	name: string;
	/** Human-readable title. */
	title?: string;
	/** Longer explanation for people and AI tools. */
	description?: string;
	/** Values a run starts with, read as `{{input.x}}`. */
	inputs: FlowValueDefinitions;
	/** Values a run returns, each with the reference it reads at the end. */
	outputs?: Record<string, FlowGraphOutputDefinition>;
	/** Ways the flow can be started, keyed by name. */
	triggers?: Record<string, FlowGraphTrigger>;
	/** Steps keyed by name. */
	steps: Record<string, FlowGraphStep>;
	/** What runs after what. */
	edges: FlowGraphEdge[];
	/** Canvas positions, kept apart so moving a box leaves the logic untouched. */
	layout?: Record<string, [number, number]>;
}

/** A flow file of either shape. */
export type AnyFlowDefinition = FlowDefinition | FlowGraphDefinition;

/**
 * Narrows a flow file to the version 2 shape.
 *
 * @param definition - Flow file contents.
 * @returns True for version 2 flows.
 */
export function isFlowGraphDefinition(definition: unknown): definition is FlowGraphDefinition {
	return Boolean(definition && typeof definition === 'object' && (definition as { schemaVersion?: unknown }).schemaVersion === 2);
}
