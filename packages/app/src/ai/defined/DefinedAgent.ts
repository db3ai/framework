import { join } from 'node:path';
import { app } from '../../server/appContext';
import { Agent } from '../Agent';
import type { AgentReasoningEffort, AgentTool, BaseAgentContext } from '../contracts/Agent';
import { renderInstructions, type AgentDefinition } from './AgentDefinition';
import { agentToolFor, registeredAgentTool } from './defineTool';
import { readAgentDefinitionSync, type StoredAgentDefinition } from './FileAgentDefinitionStore';

/** Context for a defined agent: the usual user and scope, plus the fields its definition lists. */
export type DefinedAgentContext = BaseAgentContext & Record<string, unknown>;

/** Where an app keeps its agent folders. */
export function agentDirectory(directory: string = app().directory): string {
	return join(directory, 'db3', 'agents');
}

/**
 * An agent made in the console, run from its files in `db3/agents/<name>`. It reads them each
 * time it is made, so the next message after a save uses the new version. It runs on the same
 * engine as any class agent: durable streaming, queueing, conversations and request logs.
 */
export class DefinedAgent extends Agent<DefinedAgentContext> {
	protected declare readonly model?: string;
	protected declare readonly maxTurns: number | null;
	protected declare readonly reasoningEffort: AgentReasoningEffort | null;
	protected declare readonly agentName: string;
	protected declare readonly sdkAgentName: string;
	protected declare readonly workflowName: string;
	/** The files this agent was made from. */
	readonly stored: StoredAgentDefinition;

	/**
	 * @param name - Agent name, its folder under `db3/agents`.
	 * @param context - Trusted values the caller sets.
	 * @param directory - The app's folder; defaults to the running app's.
	 */
	constructor(name: string, context: DefinedAgentContext, directory?: string) {
		super(context);
		const stored = readAgentDefinitionSync(agentDirectory(directory), name);
		if (!stored) throw new Error(`There is no agent "${name}" in db3/agents.`);
		this.stored = stored;
		const definition = stored.definition;
		this.model = definition.model;
		this.maxTurns = definition.maxTurns ?? 8;
		this.reasoningEffort = definition.reasoningEffort ?? null;
		this.agentName = definition.name;
		this.sdkAgentName = definition.name;
		this.workflowName = definition.name;
	}

	/** The definition as read. */
	get definition(): AgentDefinition {
		return this.stored.definition;
	}

	/** The instructions with `{{context.x}}` filled in. */
	async instructions(): Promise<string> {
		return renderInstructions(this.stored.instructions, this.context);
	}

	/** The definition's tools, bound to this run's context. A tool that isn't registered is an error, not a silent gap. */
	protected tools(): AgentTool[] {
		return this.definition.tools.map(reference => {
			const found = registeredAgentTool(reference.name);
			if (!found) throw new Error(`Agent ${this.definition.name} uses the tool ${reference.name}, which isn't listed in server/agents/index.ts.`);
			return agentToolFor(found, this.context);
		});
	}
}
