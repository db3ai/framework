import { z } from 'zod';

/** Agent names are folder names under `db3/agents`: lower case, digits and dashes. */
export const AGENT_NAME = /^[a-z][a-z0-9-]{0,62}$/;

const contextField = z.object({
	name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Context fields are names like customerId.'),
	description: z.string().max(500).optional(),
	/** Callers using a browser key may set it; otherwise only server code can. */
	browser: z.boolean().optional(),
}).strict();

const toolReference = z.object({
	/** A function tool written with `defineTool`, by its name. */
	kind: z.literal('function'),
	name: z.string().min(1).max(64),
}).strict();

const definition = z.object({
	version: z.literal(1),
	name: z.string().regex(AGENT_NAME, 'Agent names use lower case letters, digits and dashes.'),
	title: z.string().max(120).optional(),
	description: z.string().max(1000).optional(),
	/** Provider model; the app's default model when left out. */
	model: z.string().max(120).optional(),
	maxTurns: z.number().int().min(1).max(100).optional(),
	reasoningEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
	context: z.array(contextField).default([]),
	tools: z.array(toolReference).default([]),
}).strict();

/** One agent made in the console: `db3/agents/<name>/agent.json`, with its prompt beside it. */
export type AgentDefinition = z.infer<typeof definition>;
/** A context field callers set and the model never chooses. */
export type AgentContextField = z.infer<typeof contextField>;
/** A tool an agent definition uses. */
export type AgentToolReference = z.infer<typeof toolReference>;

/**
 * Checks an agent definition, reporting the first problem in plain words.
 *
 * @param value - Parsed JSON.
 * @returns The definition with defaults filled in.
 */
export function parseAgentDefinition(value: unknown): AgentDefinition {
	const result = definition.safeParse(value);
	if (result.success) {
		const names = new Set<string>();
		for (const field of result.data.context) {
			if (names.has(field.name)) throw new Error(`Context field ${field.name} is listed twice.`);
			names.add(field.name);
		}
		return result.data;
	}
	const issue = result.error.issues[0]!;
	throw new Error(`Agent definition${issue.path.length ? ` ${issue.path.join('.')}` : ''}: ${issue.message}`);
}

/**
 * Writes a definition as tab-indented JSON with a stable key order, one trailing newline, so a
 * file diffs the same wherever it was saved.
 *
 * @param value - Agent definition.
 * @returns File content.
 */
export function serializeAgentDefinition(value: AgentDefinition): string {
	const ordered = {
		version: value.version, name: value.name,
		...(value.title ? { title: value.title } : {}),
		...(value.description ? { description: value.description } : {}),
		...(value.model ? { model: value.model } : {}),
		...(value.maxTurns ? { maxTurns: value.maxTurns } : {}),
		...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
		context: value.context.map(field => ({ name: field.name, ...(field.description ? { description: field.description } : {}), ...(field.browser ? { browser: true } : {}) })),
		tools: value.tools.map(item => ({ kind: item.kind, name: item.name })),
	};
	return `${JSON.stringify(ordered, null, '\t')}\n`;
}

/**
 * Fills `{{context.x}}` placeholders from the agent's context. A missing value becomes empty,
 * and anything else in braces is left as written.
 *
 * @param instructions - The prompt from `instructions.md`.
 * @param context - The run's context.
 */
export function renderInstructions(instructions: string, context: Record<string, unknown>): string {
	return instructions.replace(/\{\{\s*context\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
		const value = context[name];
		if (value === null || value === undefined) return '';
		if (typeof value === 'object') return 'id' in value ? String((value as { id: unknown }).id) : JSON.stringify(value);
		return String(value);
	});
}
