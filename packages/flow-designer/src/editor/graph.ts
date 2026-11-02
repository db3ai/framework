import type { FlowBlockMetadata, FlowGraphDefinition, FlowGraphStep, FlowValue, FlowValueDefinitions, FlowValues } from '@db3.ai/app/flows';

/** The start of every flow: the run input, and the edge source `input`. */
export const START = 'input';

/** Every step's failure exit. */
export const ERROR_EXIT = 'error';

/** Box width on the canvas, in pixels. */
export const NODE_WIDTH = 214;

/** Matches one `{{path}}` reference. */
const REFERENCE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Names of steps, triggers and flows: lower case letters, digits and dashes. */
export const NAME = /^[a-z][a-z0-9-]{0,62}$/;

/** Block types from the block-and-port shape that file shape 2 has no use for. */
const SCHEMA_ONE_BLOCKS = new Set(['flow.input', 'flow.output', 'flow.subflow']);

/** One problem found by {@link checkFlow}, shown on its box and in the save message. */
export interface FlowProblem {
	/** Step name, or `flow` for problems with the flow itself. */
	step: string;
	message: string;
}

/** How a block appears in the library and on its box. */
export type BlockKind = 'trigger' | 'agent' | 'data' | 'msg' | 'flow' | 'code' | 'logic' | 'app';

/**
 * Turns a title into a step or flow name.
 *
 * @param text - Title such as `Add to CRM`.
 * @returns Name such as `add-to-crm`.
 */
export function slug(text: string): string {
	const name = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	return /^[a-z]/.test(name) ? name.slice(0, 63) : `step-${name}`.slice(0, 63).replace(/-+$/, '');
}

/**
 * Says how a block type is shown, from its type name.
 *
 * @param block - Block metadata.
 * @returns Display kind.
 */
export function blockKind(block: Pick<FlowBlockMetadata, 'type' | 'kind'>): BlockKind {
	const prefix = block.type.split('.')[0];
	if (block.kind === 'trigger' || prefix === 'trigger') return 'trigger';
	if (block.kind === 'flow' || prefix === 'flow') return 'flow';
	if (prefix === 'agent') return 'agent';
	if (prefix === 'table') return 'data';
	if (prefix === 'control') return 'logic';
	if (prefix === 'code') return 'code';
	if (['mail', 'slack', 'basecamp', 'notify'].includes(prefix)) return 'msg';
	return 'app';
}

/** Triggers the framework serves, offered in the library beside the app's blocks. */
const BUILT_IN_TRIGGERS: FlowBlockMetadata[] = [
	{ type: 'trigger.webhook', kind: 'trigger', name: 'Webhook', description: 'POST with a token; the JSON body is the input.', inputs: {}, outputs: {} },
	{ type: 'trigger.form', kind: 'trigger', name: 'Form', description: 'Hosted form built from the inputs; embed it in an iframe.', inputs: {}, outputs: {} },
	{ type: 'trigger.schedule', kind: 'trigger', name: 'Schedule', description: 'Every minute, hour or day at a time.', inputs: {}, outputs: {} },
];

/** Library group names by display kind, in library order. */
export const KIND_GROUPS: Record<BlockKind, string> = {
	trigger: 'Triggers',
	agent: 'AI',
	logic: 'Logic',
	code: 'Code',
	data: 'Data',
	flow: 'Flows',
	msg: 'Messages',
	app: 'This app',
};

/**
 * Blocks the library offers, grouped and in order.
 *
 * @param blocks - Registered block metadata.
 * @param search - Text to match against name, type and description.
 * @returns Groups with their blocks.
 */
export function libraryGroups(blocks: FlowBlockMetadata[], search = ''): { title: string; kind: BlockKind; blocks: FlowBlockMetadata[] }[] {
	const query = search.trim().toLowerCase();
	const usable = [...BUILT_IN_TRIGGERS, ...blocks].filter(block => !SCHEMA_ONE_BLOCKS.has(block.type)
		&& (!query || `${block.name} ${block.type} ${block.description ?? ''}`.toLowerCase().includes(query)));
	return (Object.keys(KIND_GROUPS) as BlockKind[])
		.map(kind => ({ title: KIND_GROUPS[kind], kind, blocks: usable.filter(block => blockKind(block) === kind) }))
		.filter(group => group.blocks.length);
}

/**
 * A block's inputs and settings together, as written under a step's `config`.
 *
 * @param block - Block metadata.
 * @returns Field contracts; inputs win over settings with the same name.
 */
export function settingFields(block: FlowBlockMetadata | undefined): FlowValueDefinitions {
	return block ? { ...(block.config ?? {}), ...block.inputs } : {};
}

/**
 * The named exits a step has, not counting `error`.
 *
 * `control.switch` gets one exit per case plus `other`, matching the runtime.
 *
 * @param step - Step in the flow file.
 * @param block - Its block metadata.
 * @returns Exit names.
 */
export function stepExits(step: FlowGraphStep, block: FlowBlockMetadata | undefined): string[] {
	if (step.type === 'control.switch') {
		const cases = step.config?.cases;
		return [...(Array.isArray(cases) ? cases.map(String) : []), 'other'];
	}
	if (step.type === 'agent.run' && typeof step.config?.exitOn === 'string') {
		const field = agentReturns(step)?.[step.config.exitOn];
		return Array.isArray(field) ? field.map(String) : [];
	}
	return block?.exits ?? [];
}

/**
 * The fields an agent step answers with, from its `returns` setting.
 *
 * @param step - Step in the flow file.
 * @returns Fields by name, or null.
 */
function agentReturns(step: FlowGraphStep): Record<string, FlowValue> | null {
	const returns = step.config?.returns;
	return returns && typeof returns === 'object' && !Array.isArray(returns) ? returns : null;
}

/**
 * The outputs a step hands later steps. Most come from the block; an agent step's come
 * from its `returns` setting (or `text`).
 *
 * @param step - Step in the flow file.
 * @param block - Its block metadata.
 * @returns Output contracts.
 */
export function stepOutputs(step: FlowGraphStep, block: FlowBlockMetadata | undefined): FlowValueDefinitions {
	if (step.type === 'agent.run') {
		const returns = agentReturns(step);
		if (!returns) return { text: { type: 'string', required: true } };
		return Object.fromEntries(Object.entries(returns).map(([name, field]) => [name, { type: Array.isArray(field) || field === 'string' ? 'string' : field === 'number' ? 'number' : 'boolean', required: true }])) as FlowValueDefinitions;
	}
	return block?.outputs ?? {};
}

/**
 * Splits an edge source such as `classify.lead` into step and exit.
 *
 * @param source - Edge source.
 * @returns Step name and exit, or null for the plain output.
 */
export function edgeSource(source: string): { step: string; exit: string | null } {
	const dot = source.indexOf('.');
	return dot < 0 ? { step: source, exit: null } : { step: source.slice(0, dot), exit: source.slice(dot + 1) };
}

/**
 * Creates an empty flow.
 *
 * @param id - New ULID.
 * @param title - Title such as `Lead intake`.
 * @returns A flow with one text input and no steps.
 */
export function blankFlow(id: string, title: string): FlowGraphDefinition {
	return {
		schemaVersion: 2,
		id,
		name: slug(title) || 'new-flow',
		title,
		inputs: {},
		outputs: {},
		triggers: {},
		steps: {},
		edges: [],
		layout: { [START]: [40, 160] },
	};
}

/**
 * Adds a step, named after its block, at a canvas position.
 *
 * @param flow - Flow to change.
 * @param block - Block to add.
 * @param at - Canvas position.
 * @returns The new step's name.
 */
export function addStep(flow: FlowGraphDefinition, block: FlowBlockMetadata, at: [number, number]): string {
	const base = slug(block.name);
	let name = base;
	for (let n = 2; flow.steps[name] || name === START; n++) name = `${base}-${n}`;

	const config: FlowValues = {};
	for (const [key, field] of Object.entries(settingFields(block))) {
		if (field.required && field.default === undefined) config[key] = emptyValue(field.type);
	}

	flow.steps[name] = { type: block.type, ...(Object.keys(config).length ? { config } : {}) };
	flow.layout = { ...(flow.layout ?? {}), [name]: [Math.round(at[0]), Math.round(at[1])] };
	return name;
}

/**
 * Removes a step with its edges and canvas position.
 *
 * @param flow - Flow to change.
 * @param name - Step name.
 */
export function removeStep(flow: FlowGraphDefinition, name: string): void {
	delete flow.steps[name];
	flow.edges = flow.edges.filter(([from, to]) => edgeSource(from).step !== name && to !== name);
	if (flow.layout) delete flow.layout[name];
}

/**
 * Renames a step everywhere: its key, edges, layout and every reference to it.
 *
 * @param flow - Flow to change.
 * @param from - Current name.
 * @param to - New name.
 * @returns An error message, or null when renamed.
 */
export function renameStep(flow: FlowGraphDefinition, from: string, to: string): string | null {
	if (from === to) return null;
	if (!NAME.test(to)) return 'Use lower case letters, digits and dashes, starting with a letter.';
	if (to === START || to === 'env' || flow.steps[to]) return `"${to}" is already used.`;

	flow.steps = Object.fromEntries(Object.entries(flow.steps).map(([name, step]) => [name === from ? to : name, step]));
	flow.edges = flow.edges.map(([source, target]) => {
		const parsed = edgeSource(source);
		const renamed = parsed.step === from ? (parsed.exit ? `${to}.${parsed.exit}` : to) : source;
		return [renamed, target === from ? to : target];
	});
	if (flow.layout?.[from]) {
		flow.layout = Object.fromEntries(Object.entries(flow.layout).map(([name, at]) => [name === from ? to : name, at]));
	}

	const rewrite = (value: FlowValue): FlowValue => {
		if (typeof value === 'string') return value.replace(REFERENCE, (match, path: string) => path === from || path.startsWith(`${from}.`) ? `{{${to}${path.slice(from.length)}}}` : match);
		if (Array.isArray(value)) return value.map(rewrite);
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
		return value;
	};
	for (const step of Object.values(flow.steps)) if (step.config) step.config = rewrite(step.config) as FlowValues;
	for (const output of Object.values(flow.outputs ?? {})) if (output.value !== undefined) output.value = rewrite(output.value);
	return null;
}

/**
 * Adds an edge unless it is already there or would lead a step to itself.
 *
 * @param flow - Flow to change.
 * @param from - `input`, a step name, or `step.exit`.
 * @param to - Step name.
 * @returns True when added.
 */
export function addEdge(flow: FlowGraphDefinition, from: string, to: string): boolean {
	if (to === START || edgeSource(from).step === to) return false;
	if (flow.edges.some(([a, b]) => a === from && b === to)) return false;
	if (leadsTo(flow, to, edgeSource(from).step)) return false;
	flow.edges.push([from, to]);
	return true;
}

/**
 * Whether a step leads, through any edges, to another.
 *
 * @param flow - Flow.
 * @param from - First step.
 * @param to - Step to look for.
 * @returns True when `to` runs after `from`.
 */
function leadsTo(flow: FlowGraphDefinition, from: string, to: string): boolean {
	const seen = new Set<string>();
	const walk = (name: string): boolean => {
		if (name === to) return true;
		if (seen.has(name)) return false;
		seen.add(name);
		return flow.edges.some(([source, target]) => edgeSource(source).step === name && walk(target));
	};
	return walk(from);
}

/**
 * Steps that run before a step, nearest last, in file order.
 *
 * @param flow - Flow.
 * @param name - Step name.
 * @returns Names of steps whose outputs this step may read.
 */
export function stepsBefore(flow: FlowGraphDefinition, name: string): string[] {
	const seen = new Set<string>();
	const walk = (target: string) => {
		for (const [source, to] of flow.edges) {
			const step = edgeSource(source).step;
			if (to === target && step !== START && !seen.has(step)) {
				seen.add(step);
				walk(step);
			}
		}
	};
	walk(name);
	return Object.keys(flow.steps).filter(step => seen.has(step));
}

/**
 * Lists the reference paths in a setting value.
 *
 * @param value - Setting value.
 * @returns Paths such as `classify.kind`.
 */
export function referencesIn(value: FlowValue | undefined): string[] {
	if (typeof value === 'string') return [...value.matchAll(REFERENCE)].map(match => match[1]);
	if (Array.isArray(value)) return value.flatMap(referencesIn);
	if (value && typeof value === 'object') return Object.values(value).flatMap(referencesIn);
	return [];
}

/**
 * Checks a flow the way the server does before saving, so problems show on the boxes.
 *
 * @param flow - Flow file.
 * @param blocks - Registered blocks.
 * @returns Problems found; empty when the flow is ready to save.
 */
export function checkFlow(flow: FlowGraphDefinition, blocks: FlowBlockMetadata[]): FlowProblem[] {
	const problems: FlowProblem[] = [];
	const byType = new Map(blocks.map(block => [block.type, block]));
	const add = (step: string, message: string) => problems.push({ step, message });

	if (!NAME.test(flow.name)) add('flow', 'The flow name uses lower case letters, digits and dashes.');
	if (!Object.keys(flow.steps).length) add('flow', 'Add at least one step.');

	for (const [name, step] of Object.entries(flow.steps)) {
		const block = byType.get(step.type);
		if (!block) {
			add(name, `Block type ${step.type} is not available here.`);
			continue;
		}
		if (!flow.edges.some(([, to]) => to === name)) add(name, 'Nothing leads to this step.');

		const fields = settingFields(block);
		for (const [key, field] of Object.entries(fields)) {
			const value = step.config?.[key];
			if (field.required && field.default === undefined && (value === undefined || value === '')) add(name, `${key} is required.`);
		}

		const exits = stepExits(step, block);
		for (const [source] of flow.edges) {
			const parsed = edgeSource(source);
			if (parsed.step !== name) continue;
			if (parsed.exit === null && exits.length) add(name, `Pick an exit for each connection (${exits.join(', ')}).`);
			if (parsed.exit !== null && parsed.exit !== ERROR_EXIT && !exits.includes(parsed.exit)) add(name, `There is no exit ${parsed.exit}.`);
		}

		const before = new Set(stepsBefore(flow, name));
		for (const path of referencesIn(step.config)) {
			const [root, field] = path.split('.');
			if (root === START) {
				if (field && !(field in flow.inputs)) add(name, `The flow has no input ${field}.`);
			} else if (root === 'env') {
				if (!field) add(name, 'Name the setting, as in {{env.MEETING_LINK}}.');
			} else if (!flow.steps[root]) {
				add(name, `{{${path}}} reads a step that does not exist.`);
			} else if (!before.has(root)) {
				add(name, `{{${path}}} reads ${root}, which does not run before this step.`);
			} else {
				// Blocks whose outputs depend on their settings (such as an agent's returns) declare none; the server checks those.
				const outputs = stepOutputs(flow.steps[root], byType.get(flow.steps[root].type));
				if (field && field !== ERROR_EXIT && Object.keys(outputs).length && !(field in outputs)) add(name, `${root} has no output ${field}.`);
			}
		}
	}

	if (Object.keys(flow.steps).length && !flow.edges.some(([from]) => from === START)) add('flow', 'Connect Start to the first step.');
	return problems;
}

/**
 * Orders a flow file's keys the way the file store writes them.
 *
 * @param flow - Flow file.
 * @returns Pretty JSON.
 */
export function flowFileText(flow: FlowGraphDefinition): string {
	const { schemaVersion, id, name, title, description, inputs, outputs, triggers, steps, edges, layout } = flow;
	return JSON.stringify({ schemaVersion, id, name, title, description, inputs, outputs, triggers, steps, edges, layout }, null, '\t');
}

/**
 * An empty value for a field type, used when a required setting is first added.
 *
 * @param type - Field type.
 * @returns Empty value.
 */
function emptyValue(type: string): FlowValue {
	return type === 'number' ? 0 : type === 'boolean' ? false : type === 'array' ? [] : type === 'object' ? {} : '';
}

/** Trigger types the framework serves, plus any trigger blocks the app registers. */
export const TRIGGER_TYPES = ['trigger.webhook', 'trigger.form', 'trigger.schedule'];

/**
 * Starting settings for a new trigger, so it checks straight away.
 *
 * @param type - Trigger type.
 * @param flowName - Flow name, used to name the webhook token setting.
 * @returns Trigger settings.
 */
export function triggerDefaults(type: string, flowName: string): FlowValues | undefined {
	if (type === 'trigger.webhook') return { token: { secret: `${flowName.toUpperCase().replace(/-/g, '_')}_WEBHOOK_TOKEN` } };
	if (type === 'trigger.form') return { title: 'Contact us', thanks: 'Thank you. We have your message.' };
	if (type === 'trigger.schedule') return { every: 'day', at: '07:00' };
	return undefined;
}

/**
 * Where the running app serves a trigger, relative to the app's address.
 *
 * @param type - Trigger type.
 * @param flowName - Flow name.
 * @param triggerName - Trigger name.
 * @returns Path, or null for triggers with no address.
 */
export function triggerPath(type: string, flowName: string, triggerName: string): string | null {
	if (type === 'trigger.webhook') return `POST /_db3/flows/${flowName}/${triggerName}`;
	if (type === 'trigger.form') return `/_db3/flows/${flowName}/${triggerName}/form`;
	return null;
}

/**
 * Shows a setting value in a text box.
 *
 * @param value - Setting value.
 * @returns Text; JSON for objects and lists.
 */
export function settingText(value: FlowValue | undefined): string {
	if (value === undefined || value === null) return '';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Reads a text box back into a setting value of the field's type.
 *
 * Text holding a `{{reference}}` stays text: the reference is resolved when the step runs.
 *
 * @param text - Text typed.
 * @param type - Field type.
 * @returns Setting value, or undefined to remove it.
 */
export function settingValue(text: string, type: string | undefined): FlowValue | undefined {
	if (text === '') return undefined;
	if (/^\s*\{\{[^{}]+\}\}\s*$/.test(text) || type === 'string' || type === undefined) return text;
	if (type === 'number' && text.trim() !== '' && Number.isFinite(Number(text))) return Number(text);
	if (type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
	try {
		return JSON.parse(text) as FlowValue;
	} catch {
		return text;
	}
}

/**
 * Places steps that have no canvas position in columns by how far they are from Start.
 *
 * @param flow - Flow to change.
 */
export function placeUnplaced(flow: FlowGraphDefinition): void {
	const layout = { ...(flow.layout ?? {}) };
	layout[START] ??= [40, 160];
	const depth = new Map<string, number>([[START, 0]]);
	for (let pass = 0; pass < Object.keys(flow.steps).length + 1; pass++) {
		for (const [source, to] of flow.edges) {
			const from = depth.get(edgeSource(source).step);
			if (from !== undefined && (depth.get(to) ?? -1) < from + 1) depth.set(to, from + 1);
		}
	}
	const rows = new Map<number, number>();
	for (const name of Object.keys(flow.steps)) {
		if (layout[name]) continue;
		const column = depth.get(name) ?? 1;
		const row = rows.get(column) ?? 0;
		rows.set(column, row + 1);
		layout[name] = [40 + column * 290, 60 + row * 150];
	}
	flow.layout = layout;
}
