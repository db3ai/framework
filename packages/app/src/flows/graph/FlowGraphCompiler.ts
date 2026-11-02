import { isUlid } from '@db3.ai/pure/ulid';

import type { FlowBlockDefinition, FlowGraphDefinition, FlowGraphStep, FlowValueDefinitions, FlowValues } from '../contracts';
import type { FlowBlockRegistry } from '../FlowBlockRegistry';
import { validateValueDefinitions } from '../FlowCompiler';
import { triggerProblems } from '../triggers/triggerProblems';
import { FlowDefinitionError, type FlowDefinitionIssue } from '../FlowDefinitionError';
import { matchesDefinition } from '../flowValueValidator';
import { FLOW_REFERENCE_ROOTS, referencesIn, secretsIn } from './references';

/** Flow and step names: lower case letters, digits and dashes. */
export const FLOW_GRAPH_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** The exit every step has for a failure after its last retry. */
export const FLOW_ERROR_EXIT = 'error';

/** Built-in ways into a flow. Apps may register more as blocks of kind `trigger`. */
export const FLOW_TRIGGER_TYPES = ['trigger.webhook', 'trigger.form', 'trigger.schedule'] as const;

const RESERVED_STEP_NAMES = new Set<string>([...FLOW_REFERENCE_ROOTS, 'output', 'outputs', 'trigger', 'request']);

/**
 * One edge after parsing: the step it leaves, the exit it leaves by, and where it goes.
 */
export interface CompiledFlowEdge {
	/** Step the edge leaves, or `input` for the start of the run. */
	from: string;
	/** Exit the edge leaves by; null for a step's only way out. */
	exit: string | null;
	/** Step the edge enters. */
	to: string;
}

/**
 * One step after checking, with its block and everything the runtime needs.
 */
export interface CompiledFlowStep {
	/** Step name. */
	name: string;
	/** Step as written in the file. */
	step: FlowGraphStep;
	/** Registered block type. */
	block: FlowBlockDefinition;
	/** Position in a valid run order. */
	sequence: number;
	/** Block outputs for this step's settings. */
	outputs: FlowValueDefinitions;
	/** Named exits; empty when the step has one way out. */
	exits: string[];
	/** Edges entering the step. */
	incoming: CompiledFlowEdge[];
	/** Edges leaving the step. */
	outgoing: CompiledFlowEdge[];
	/** Steps that can run before this one, so its references may read them. */
	ancestors: Set<string>;
}

/**
 * A checked flow, steps in run order.
 */
export interface CompiledFlowGraph {
	/** The flow file. */
	definition: FlowGraphDefinition;
	/** Steps in a valid run order. */
	steps: CompiledFlowStep[];
	/** Steps by name. */
	byName: Map<string, CompiledFlowStep>;
}

/**
 * Checks a version 2 flow and puts its steps in run order.
 *
 * Checks shape, names, block types, settings, edges and exits, that every step
 * can be reached from the start without loops, and that every `{{reference}}`
 * reads a run input, a setting, or an output of a step that runs before it.
 */
export class FlowGraphCompiler {
	/**
	 * @param blocks - Registered block types.
	 */
	constructor(private readonly blocks: FlowBlockRegistry) {}

	/**
	 * @param definition - Flow file contents.
	 * @returns Steps in run order.
	 * @throws FlowDefinitionError listing every problem found.
	 */
	compile(definition: FlowGraphDefinition): CompiledFlowGraph {
		const issues: FlowDefinitionIssue[] = [];
		this.#checkEnvelope(definition, issues);

		const stepEntries = definition && isRecord(definition.steps) ? Object.entries(definition.steps) : [];
		const steps = new Map<string, Omit<CompiledFlowStep, 'sequence' | 'ancestors'>>();

		for (const [name, step] of stepEntries) {
			const compiled = this.#checkStep(name, step, issues);
			if (compiled) steps.set(name, compiled);
		}

		for (const [name, trigger] of Object.entries(definition?.triggers ?? {})) {
			const registered = trigger && typeof trigger.type === 'string' ? this.blocks.get(trigger.type) : null;
			if (!FLOW_GRAPH_NAME.test(name)) issues.push({ path: `triggers.${name}`, message: 'Trigger names use lower case letters, digits and dashes.' });
			if (!trigger || typeof trigger.type !== 'string') issues.push({ path: `triggers.${name}.type`, message: 'Trigger type is required.' });
			else if (!(FLOW_TRIGGER_TYPES as readonly string[]).includes(trigger.type) && registered?.kind !== 'trigger') {
				issues.push({ path: `triggers.${name}.type`, message: `"${trigger.type}" is not a trigger type.` });
			}
			else for (const message of triggerProblems(trigger.type, trigger.config)) issues.push({ path: `triggers.${name}.config`, message });
		}

		const edges = this.#checkEdges(definition, steps, issues);
		const order = runOrder([...steps.keys()], edges);

		if (order.length < steps.size && steps.size === stepEntries.length) {
			issues.push({ path: 'edges', message: `These steps are in a loop: ${[...steps.keys()].filter(name => !order.includes(name)).join(', ')}.` });
		}

		const ancestors = ancestorsOf(order, edges);
		const compiled: CompiledFlowStep[] = order.map((name, sequence) => ({ ...steps.get(name)!, sequence, ancestors: ancestors.get(name)! }));
		const byName = new Map(compiled.map(step => [step.name, step]));

		for (const step of compiled) {
			if (!step.incoming.length) issues.push({ path: `steps.${step.name}`, message: 'Nothing leads to this step. Connect it to input or an earlier step.' });
			this.#checkReferences(`steps.${step.name}.config`, step.step.config ?? {}, definition, byName, step.ancestors, issues);
		}

		for (const [name, output] of Object.entries(definition?.outputs ?? {})) {
			this.#checkReferences(`outputs.${name}.value`, { value: output?.value ?? null }, definition, byName, new Set(byName.keys()), issues);
		}

		if (issues.length) throw new FlowDefinitionError(issues);
		return { definition, steps: compiled, byName };
	}

	#checkEnvelope(definition: FlowGraphDefinition, issues: FlowDefinitionIssue[]): void {
		if (!isRecord(definition)) {
			issues.push({ path: '$', message: 'A flow must be an object.' });
			return;
		}
		if (definition.schemaVersion !== 2) issues.push({ path: 'schemaVersion', message: 'Expected schemaVersion 2.' });
		if (!isUlid(definition.id)) issues.push({ path: 'id', message: 'Flow id must be a ULID.' });
		if (typeof definition.name !== 'string' || !FLOW_GRAPH_NAME.test(definition.name)) issues.push({ path: 'name', message: 'Flow names use lower case letters, digits and dashes.' });
		validateValueDefinitions(definition.inputs, 'inputs', issues);
		if (definition.outputs !== undefined) validateValueDefinitions(definition.outputs, 'outputs', issues);
		if (!isRecord(definition.steps) || !Object.keys(definition.steps).length) issues.push({ path: 'steps', message: 'A flow needs at least one step.' });
		if (!Array.isArray(definition.edges)) issues.push({ path: 'edges', message: 'Edges must be a list of [from, to] pairs.' });
	}

	#checkStep(name: string, step: FlowGraphStep, issues: FlowDefinitionIssue[]): Omit<CompiledFlowStep, 'sequence' | 'ancestors'> | null {
		const path = `steps.${name}`;
		if (!FLOW_GRAPH_NAME.test(name) || RESERVED_STEP_NAMES.has(name)) {
			issues.push({ path, message: RESERVED_STEP_NAMES.has(name) ? `"${name}" is reserved; pick another step name.` : 'Step names use lower case letters, digits and dashes.' });
		}
		if (!isRecord(step) || typeof step.type !== 'string') {
			issues.push({ path: `${path}.type`, message: 'Step type is required.' });
			return null;
		}

		const block = this.blocks.get(step.type);
		if (!block) {
			issues.push({ path: `${path}.type`, message: `Block type "${step.type}" is not registered.` });
			return null;
		}
		if (block.kind === 'trigger') {
			issues.push({ path: `${path}.type`, message: 'Triggers go in the triggers section, not steps.' });
			return null;
		}
		if ((block.kind ?? 'function') === 'flow' && (typeof step.flow !== 'string' || !FLOW_GRAPH_NAME.test(step.flow))) {
			issues.push({ path: `${path}.flow`, message: 'Name the flow this step runs.' });
		}

		const config = step.config ?? {};
		if (!isRecord(config)) {
			issues.push({ path: `${path}.config`, message: 'Settings must be an object.' });
			return null;
		}

		const fields = settingFields(block);
		for (const [key, value] of Object.entries(config)) {
			const field = fields[key];
			if (!field) {
				issues.push({ path: `${path}.config.${key}`, message: `${block.name} has no setting "${key}".` });
				continue;
			}
			if (!referencesIn(value).length && !secretsIn(value).length && value !== null && !matchesDefinition(value, field)) {
				issues.push({ path: `${path}.config.${key}`, message: `Expected ${field.type}.` });
			}
		}
		for (const [key, field] of Object.entries(fields)) {
			if (field.required && field.default === undefined && config[key] === undefined) {
				issues.push({ path: `${path}.config.${key}`, message: `${block.name} needs "${key}".` });
			}
		}

		let outputs: FlowValueDefinitions = block.outputs;
		let exits: string[] = block.exits ?? [];
		try {
			outputs = block.outputsFor?.(config) ?? block.outputs;
			exits = block.exitsFor?.(config) ?? block.exits ?? [];
		} catch (error) {
			issues.push({ path: `${path}.config`, message: error instanceof Error ? error.message : String(error) });
		}
		if (exits.includes(FLOW_ERROR_EXIT)) issues.push({ path, message: `"${FLOW_ERROR_EXIT}" is every step's failure exit; a block cannot declare it.` });

		return { name, step, block, outputs, exits, incoming: [], outgoing: [] };
	}

	#checkEdges(definition: FlowGraphDefinition, steps: Map<string, Omit<CompiledFlowStep, 'sequence' | 'ancestors'>>, issues: FlowDefinitionIssue[]): CompiledFlowEdge[] {
		const edges: CompiledFlowEdge[] = [];
		const seen = new Set<string>();

		for (const [index, edge] of (Array.isArray(definition?.edges) ? definition.edges : []).entries()) {
			const path = `edges[${index}]`;
			if (!Array.isArray(edge) || edge.length !== 2 || typeof edge[0] !== 'string' || typeof edge[1] !== 'string') {
				issues.push({ path, message: 'Each edge is a [from, to] pair.' });
				continue;
			}

			const [source, to] = edge;
			const dot = source.indexOf('.');
			const from = dot < 0 ? source : source.slice(0, dot);
			const exit = dot < 0 ? null : source.slice(dot + 1);
			const fromStep = steps.get(from);
			const key = `${source}>${to}`;

			if (seen.has(key)) issues.push({ path, message: `${source} → ${to} is listed twice.` });
			seen.add(key);

			if (!steps.has(to)) {
				if (!definition.steps?.[to]) issues.push({ path, message: to === 'input' ? 'Nothing can lead into input.' : `There is no step "${to}".` });
				continue;
			}
			if (from === to) {
				issues.push({ path, message: 'A step cannot lead to itself.' });
				continue;
			}
			if (from === 'input') {
				if (exit !== null) issues.push({ path, message: 'input has no exits.' });
			} else if (!fromStep) {
				if (!definition.steps?.[from]) issues.push({ path, message: `There is no step "${from}".` });
				continue;
			} else if (exit === null && fromStep.exits.length) {
				issues.push({ path, message: `${from} has exits (${fromStep.exits.join(', ')}); pick one, as in "${from}.${fromStep.exits[0]}".` });
			} else if (exit !== null && exit !== FLOW_ERROR_EXIT && !fromStep.exits.includes(exit)) {
				issues.push({ path, message: `${from} has no exit "${exit}".` });
			}

			const compiled = { from, exit, to };
			edges.push(compiled);
			fromStep?.outgoing.push(compiled);
			steps.get(to)!.incoming.push(compiled);
		}

		if (steps.size && !edges.some(edge => edge.from === 'input')) issues.push({ path: 'edges', message: 'Connect input to the first step.' });
		return edges;
	}

	#checkReferences(
		path: string,
		config: FlowValues,
		definition: FlowGraphDefinition,
		steps: Map<string, CompiledFlowStep>,
		readable: Set<string>,
		issues: FlowDefinitionIssue[],
	): void {
		for (const [key, value] of Object.entries(config)) {
			for (const reference of referencesIn(value)) {
				const [root, field] = reference.split('.');
				const at = `${path}.${key}`;

				if (root === 'env') {
					if (!field) issues.push({ path: at, message: 'Name the setting, as in {{env.MEETING_LINK}}.' });
				} else if (root === 'input') {
					if (field && !(field in (definition.inputs ?? {}))) issues.push({ path: at, message: `The flow has no input "${field}".` });
				} else if (!steps.has(root)) {
					issues.push({ path: at, message: `{{${reference}}}: there is no step "${root}".` });
				} else if (!readable.has(root)) {
					issues.push({ path: at, message: `{{${reference}}}: ${root} does not run before this step.` });
				} else if (field && !(field in steps.get(root)!.outputs) && field !== FLOW_ERROR_EXIT) {
					issues.push({ path: at, message: `{{${reference}}}: ${root} has no output "${field}".` });
				}
			}
		}
	}
}

/**
 * A block's inputs and settings together; in a flow file both are written under `config`.
 *
 * @param block - Registered block type.
 * @returns Field contracts by name; inputs win over settings with the same name.
 */
export function settingFields(block: FlowBlockDefinition): FlowValueDefinitions {
	return { ...(block.config ?? {}), ...block.inputs };
}

/**
 * Orders steps so each comes after every step with an edge into it.
 *
 * @param names - Step names.
 * @param edges - Parsed edges.
 * @returns Names in run order; steps caught in a loop are left out.
 */
function runOrder(names: string[], edges: CompiledFlowEdge[]): string[] {
	const waiting = new Map(names.map(name => [name, new Set(edges.filter(edge => edge.to === name && edge.from !== 'input').map(edge => edge.from))]));
	const order: string[] = [];

	while (true) {
		const ready = names.filter(name => !order.includes(name) && [...waiting.get(name)!].every(from => order.includes(from)));
		if (!ready.length) return order;
		order.push(...ready);
	}
}

/**
 * Lists, for each step, every step that may run before it.
 *
 * @param order - Step names in run order.
 * @param edges - Parsed edges.
 * @returns Ancestor names by step.
 */
function ancestorsOf(order: string[], edges: CompiledFlowEdge[]): Map<string, Set<string>> {
	const result = new Map<string, Set<string>>();

	for (const name of order) {
		const ancestors = new Set<string>();
		for (const edge of edges) {
			if (edge.to !== name || edge.from === 'input') continue;
			ancestors.add(edge.from);
			for (const earlier of result.get(edge.from) ?? []) ancestors.add(earlier);
		}
		result.set(name, ancestors);
	}

	return result;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
