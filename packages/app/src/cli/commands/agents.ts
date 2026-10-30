import { join } from 'node:path';
import { z } from 'zod';
import type * as aiModule from '../../ai';
import type { CliCommand } from '../contracts';

/** What `server/agents/index.ts` exports, read in the app's own module scope. */
export interface AppAgentsModule {
	/** Agent classes: from `defineAgent`, or plain `Agent` subclasses. */
	agents: readonly unknown[];
	/** Function tools from `defineTool`, offered to agents made in the console. */
	tools: readonly aiModule.FunctionTool[];
	/** The framework's AI module in the same scope, so agents share the running app. */
	ai: typeof aiModule;
}

/** One agent as `db3 agents:list --json` describes it. */
export interface AgentDescription {
	name: string;
	/** `files`: only `db3/agents`; `code`: `defineAgent` without files; `files+code`: `defineAgent({ from })`; `class`: a plain Agent subclass. */
	kind: 'files' | 'code' | 'files+code' | 'class';
	title: string | null;
	description: string | null;
	model: string | null;
	maxTurns: number | null;
	reasoningEffort: string | null;
	context: { name: string; description?: string; browser?: boolean }[];
	tools: string[];
	/** The prompt when it is fixed text; null when code builds it for each run. */
	instructions: string | null;
	/** Parts set in code, which the console shows read-only. */
	overrides: string[];
	/** The agent's folder, `db3/agents/<name>`, when it has files. */
	path: string | null;
	revision: string | null;
	/** The class name, for a class or defineAgent export. */
	className: string | null;
}

/**
 * The `agents:list` and `agents:run` commands. Dock uses them to show an app's agents and run
 * its playground in the project folder, so the app serves nothing for this.
 *
 * @param load - Loads `server/agents/index.ts` (when there is one) and the AI module, in the app's scope.
 */
export function createAgentsCommands(load: () => Promise<AppAgentsModule>): CliCommand[] {
	return [
		{
			name: 'agents:list',
			description: "List the app's agents (db3/agents and server/agents) and the tools they can use.",
			options: [{ name: 'json', type: 'boolean', description: 'Write a versioned JSON description.' }],
			async run(context) {
				const loaded = await load();
				loaded.ai.registerAgentTools(loaded.tools);
				const agents = await describeAgents(context.directory, loaded);
				const tools = loaded.ai.registeredAgentTools().map(item => ({ name: item.name, title: item.title ?? item.name, description: item.description, parameters: z.toJSONSchema(item.parameters) }));
				if (context.options.json) context.write(JSON.stringify({ formatVersion: 1, agents, tools }, null, 2));
				else context.write(agents.map(item => `${item.name}  ${item.kind}${item.model ? `  ${item.model}` : ''}`).join('\n') || 'No agents yet. Add one in db3/agents or server/agents/index.ts.');
			},
		},
		{
			name: 'agents:run',
			description: 'Run one agent with a message and stream its events as JSON lines.',
			arguments: [{ name: 'agent', required: true }],
			options: [
				{ name: 'message', type: 'string', required: true, description: 'What to send the agent.' },
				{ name: 'context', type: 'string', description: 'Trusted context as JSON, such as {"customerId":"cus_1"}.' },
				{ name: 'conversation', type: 'string', description: 'Continue this conversation id.' },
			],
			execution: 'once',
			async run(context) {
				const loaded = await load();
				await context.prepareApp();
				loaded.ai.registerAgentTools(loaded.tools);
				let values: Record<string, unknown> = {};
				try { values = context.options.context ? JSON.parse(String(context.options.context)) as Record<string, unknown> : {}; }
				catch { context.write(JSON.stringify({ type: 'run.error', error: { code: 'invalid_context', message: '--context must be JSON.' } })); return 1; }
				if (!values || typeof values !== 'object' || Array.isArray(values)) values = {};
				const runContext = { user: 'console', scope: 'console', ...values, ...(context.options.conversation ? { conversationId: String(context.options.conversation) } : {}) };
				const name = context.args[0]!;
				const agent = agentFor(name, runContext, loaded, context.directory);
				let failed = false;
				await agent.stream(String(context.options.message), event => {
					if (event.type === 'run.error') failed = true;
					context.write(JSON.stringify(event));
				});
				return failed ? 1 : 0;
			},
		},
	];
}

type AnyAgentClass = (new (context: Record<string, unknown>) => aiModule.Agent) & { spec?: aiModule.AgentSpec; overrides?: readonly string[]; name: string };

/** Builds the agent to run: a code agent by its name, else the files in db3/agents. */
function agentFor(name: string, context: Record<string, unknown>, loaded: AppAgentsModule, directory: string): aiModule.Agent {
	for (const candidate of loaded.agents as AnyAgentClass[]) {
		if (typeof candidate !== 'function') continue;
		if (candidate.spec?.name === name) return new candidate(context);
		if (!candidate.spec && safe(() => field(new candidate({}), 'agentName')) === name) return new candidate(context);
	}
	return new loaded.ai.DefinedAgent(name, context, directory);
}

/** Describes every agent: files first, then code; a code agent built on files replaces that entry. */
export async function describeAgents(directory: string, loaded: AppAgentsModule): Promise<AgentDescription[]> {
	const store = new loaded.ai.FileAgentDefinitionStore(join(directory, 'db3', 'agents'));
	const byName = new Map<string, AgentDescription>();
	for (const stored of await store.list()) {
		const definition = stored.definition;
		byName.set(definition.name, {
			name: definition.name, kind: 'files', title: definition.title ?? null, description: definition.description ?? null,
			model: definition.model ?? null, maxTurns: definition.maxTurns ?? null, reasoningEffort: definition.reasoningEffort ?? null,
			context: definition.context, tools: definition.tools.map(item => item.name), instructions: stored.instructions,
			overrides: [], path: `db3/agents/${stored.path}`, revision: stored.revision, className: null,
		});
	}
	for (const candidate of loaded.agents as AnyAgentClass[]) {
		if (typeof candidate !== 'function') continue;
		const spec = candidate.spec;
		if (spec) {
			const files = spec.from ? byName.get(spec.from) ?? null : null;
			const tools = typeof spec.tools === 'function' ? null : spec.tools?.map(item => item.name);
			byName.set(spec.name, {
				name: spec.name, kind: spec.from ? 'files+code' : 'code',
				title: spec.title ?? files?.title ?? null, description: spec.description ?? files?.description ?? null,
				model: spec.model ?? files?.model ?? null, maxTurns: spec.maxTurns ?? files?.maxTurns ?? null, reasoningEffort: spec.reasoningEffort ?? files?.reasoningEffort ?? null,
				context: spec.context ?? files?.context ?? [], tools: tools ?? files?.tools ?? [],
				instructions: spec.instructions === undefined ? files?.instructions ?? null : typeof spec.instructions === 'string' ? spec.instructions : null,
				overrides: [...(candidate.overrides ?? [])], path: files?.path ?? null, revision: files?.revision ?? null, className: candidate.name || null,
			});
			if (spec.from && spec.from !== spec.name) byName.delete(spec.from);
			continue;
		}
		const instance = safe(() => new candidate({}));
		if (!instance) continue;
		const name = String(field(instance, 'agentName') ?? candidate.name);
		const tools = safe(() => (instance as unknown as { tools(): { name: string }[] }).tools().map(item => item.name));
		byName.set(name, {
			name, kind: 'class', title: null, description: null,
			model: (field(instance, 'model') as string | undefined) ?? null, maxTurns: (field(instance, 'maxTurns') as number | null | undefined) ?? null,
			reasoningEffort: (field(instance, 'reasoningEffort') as string | null | undefined) ?? null,
			context: [], tools: tools ?? [], instructions: null,
			overrides: ['instructions', 'tools', 'model', 'maxTurns', 'reasoningEffort', 'context'], path: null, revision: null, className: candidate.name || null,
		});
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads a protected agent setting for display. */
function field(instance: object, name: string): unknown {
	return (instance as Record<string, unknown>)[name];
}

/** Runs a probe of app code, treating a throw as "can't tell". */
function safe<T>(probe: () => T): T | null {
	try { return probe(); } catch { return null; }
}
