import { Agent } from '../Agent';
import type { AgentReasoningEffort, AgentTool } from '../contracts/Agent';
import { AGENT_NAME, renderInstructions, type AgentContextField } from './AgentDefinition';
import { DefinedAgent, type DefinedAgentContext } from './DefinedAgent';
import { agentToolFor, registeredAgentTool, type FunctionTool } from './defineTool';

/** What the instructions and tools functions get: the run's context, and what the files say. */
export interface AgentSpecInput<TBase> {
	context: DefinedAgentContext;
	/** The value from `db3/agents/<from>` when the agent extends one; otherwise empty. */
	base: TBase;
}

/** An agent written in code with {@link defineAgent}. */
export interface AgentSpec {
	/** Stable name, used for conversations, logs and the queue; lower case with dashes. */
	name: string;
	/**
	 * A defined agent in `db3/agents` to start from. Anything set here replaces that part of the
	 * files, and the console shows it read-only; everything else stays editable in the console.
	 */
	from?: string;
	title?: string;
	description?: string;
	model?: string;
	maxTurns?: number;
	reasoningEffort?: AgentReasoningEffort;
	/** Context fields callers set; the model never chooses them. */
	context?: AgentContextField[];
	/** The prompt, or a function that builds it for one run. `{{context.x}}` works in either. */
	instructions?: string | ((input: AgentSpecInput<string>) => string | Promise<string>);
	/** Tools made with `defineTool`, or a function that picks them for one run. */
	tools?: FunctionTool[] | ((input: AgentSpecInput<FunctionTool[]>) => FunctionTool[]);
}

/** The class {@link defineAgent} returns: a normal agent class, plus what it was defined with. */
export type DefinedAgentClass = (new (context: DefinedAgentContext) => Agent<DefinedAgentContext>) & {
	readonly spec: Readonly<AgentSpec>;
	/** The parts of the spec set in code, which the console can't edit. */
	readonly overrides: readonly (keyof AgentSpec)[];
};

const EDITABLE: (keyof AgentSpec)[] = ['title', 'description', 'model', 'maxTurns', 'reasoningEffort', 'context', 'instructions', 'tools'];

/**
 * Defines an agent in code, in the same shape as `defineTool` and `defineBlock`. It returns an
 * ordinary agent class, so `new SupportAgent(context).stream(...)`, `.queue()` and the queue
 * registry work as for any agent. With `from`, it starts from the agent's files in `db3/agents`
 * and only replaces what it sets.
 *
 * @example
 * ```ts
 * export const SupportAgent = defineAgent({
 * 	name: 'support',
 * 	from: 'support',
 * 	instructions: async ({ base }) => `${base}\n\n${await policy.current()}`,
 * });
 * ```
 */
export function defineAgent(spec: AgentSpec): DefinedAgentClass {
	if (!AGENT_NAME.test(spec.name)) throw new Error(`Agent names use lower case letters, digits and dashes; "${spec.name}" does not.`);
	if (!spec.from && spec.instructions === undefined) throw new Error(`Agent ${spec.name} needs instructions, or from: a defined agent to start from.`);
	const overrides = EDITABLE.filter(key => spec[key] !== undefined);
	const frozen = Object.freeze({ ...spec });

	if (spec.from) {
		const from = spec.from;
		const Extended = class extends DefinedAgent {
			static readonly spec = frozen;
			static readonly overrides = overrides;
			constructor(context: DefinedAgentContext) {
				super(from, context);
				Object.assign(this, settings(spec, spec.name));
			}
			async instructions(): Promise<string> {
				const base = await super.instructions();
				return instructionsFor(spec, this.context, base);
			}
			protected tools(): AgentTool[] {
				if (spec.tools === undefined) return super.tools();
				const base = this.definition.tools.map(reference => registeredAgentTool(reference.name)).filter((item): item is FunctionTool => item !== null);
				const chosen = typeof spec.tools === 'function' ? spec.tools({ context: this.context, base }) : spec.tools;
				return chosen.map(item => agentToolFor(item, this.context));
			}
		};
		return Extended as unknown as DefinedAgentClass;
	}

	const Coded = class extends Agent<DefinedAgentContext> {
		static readonly spec = frozen;
		static readonly overrides = overrides;
		constructor(context: DefinedAgentContext) {
			super(context);
			Object.assign(this, settings(spec, spec.name));
		}
		async instructions(): Promise<string> {
			return instructionsFor(spec, this.context, '');
		}
		protected tools(): AgentTool[] {
			const chosen = typeof spec.tools === 'function' ? spec.tools({ context: this.context, base: [] }) : spec.tools ?? [];
			return chosen.map(item => agentToolFor(item, this.context));
		}
	};
	return Coded as unknown as DefinedAgentClass;
}

/** The runtime settings a spec sets, under the names the agent engine reads. */
function settings(spec: AgentSpec, name: string): Record<string, unknown> {
	return {
		agentName: name, sdkAgentName: name, workflowName: name,
		...(spec.model !== undefined ? { model: spec.model } : {}),
		...(spec.maxTurns !== undefined ? { maxTurns: spec.maxTurns } : {}),
		...(spec.reasoningEffort !== undefined ? { reasoningEffort: spec.reasoningEffort } : {}),
	};
}

async function instructionsFor(spec: AgentSpec, context: DefinedAgentContext, base: string): Promise<string> {
	if (spec.instructions === undefined) return base;
	const text = typeof spec.instructions === 'function' ? await spec.instructions({ context, base }) : spec.instructions;
	return renderInstructions(text, context);
}
