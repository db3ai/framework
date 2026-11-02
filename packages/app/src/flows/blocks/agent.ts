import type { FlowBlockDefinition, FlowValue, FlowValueDefinitions, FlowValues } from '../contracts';
import { exit } from '../defineBlock';

/** Block type of the agent step. */
export const AGENT_RUN_BLOCK_TYPE = 'agent.run';

/** What one `returns` field may be: a value type, or a list of allowed words. */
type ReturnField = 'string' | 'number' | 'boolean' | string[];

/**
 * Runs an agent from `db3/agents` with a message, and hands back its reply.
 *
 * With `returns`, the agent must answer with JSON of that shape and each field becomes an
 * output. A field given as a list of words, named by `exitOn`, also picks the step's exit:
 *
 * ```json
 * "classify": {
 *   "type": "agent.run",
 *   "config": {
 *     "agent": "lead-classifier",
 *     "message": "From {{input.name}}: {{input.message}}",
 *     "returns": { "kind": ["spam", "lead", "support"], "reason": "string" },
 *     "exitOn": "kind"
 *   }
 * }
 * ```
 * gives outputs `kind` and `reason`, and exits `spam`, `lead` and `support`.
 * Without `returns`, the output is `text`.
 */
export const AgentRun: FlowBlockDefinition = {
	type: AGENT_RUN_BLOCK_TYPE,
	name: 'Run agent',
	description: 'Asks an agent from db3/agents; with returns, it answers in fields and can choose the exit.',
	inputs: {
		message: { type: 'string', required: true, description: 'What to ask, usually with references.', editor: { rows: 3 } },
	},
	config: {
		agent: { type: 'string', required: true, description: 'Agent name, its folder in db3/agents.' },
		returns: { type: 'object', description: 'Fields the agent answers with: "string", "number", "boolean", or a list of allowed words.' },
		exitOn: { type: 'string', description: 'A returns field given as a list of words; its value picks the exit.' },
		context: { type: 'object', description: 'Values for the agent\'s {{context.x}} placeholders.' },
	},
	outputs: {},
	outputsFor(config) {
		const returns = readReturns(config.returns);
		if (!returns) return { text: { type: 'string', required: true } };
		return Object.fromEntries(Object.entries(returns).map(([name, field]) => [name, {
			type: Array.isArray(field) ? 'string' : field,
			required: true,
		}])) as FlowValueDefinitions;
	},
	exitsFor(config) {
		if (config.exitOn === undefined) return [];
		const returns = readReturns(config.returns);
		const field = returns?.[String(config.exitOn)];
		if (!Array.isArray(field)) throw new Error('exitOn names a returns field given as a list of words, such as "kind": ["spam", "lead"].');
		return field;
	},
	async run(input, context) {
		const returns = readReturns(context.config.returns);
		const { DefinedAgent } = await import('../../ai/defined/DefinedAgent');
		const schema = returns ? jsonSchema(returns) : null;

		/** The named agent, answering in the step's JSON shape when it has one. */
		class FlowStepAgent extends DefinedAgent {
			protected override outputType() {
				return schema;
			}
		}

		const agentContext = (context.config.context && typeof context.config.context === 'object' && !Array.isArray(context.config.context) ? context.config.context : {}) as FlowValues;
		const agent = new FlowStepAgent(String(context.config.agent), { ...agentContext, flowRunId: context.runId });
		const result = await agent.run(String(input.message));
		await context.log('info', `${String(context.config.agent)} answered.`, { conversationId: result.conversationId, costUSD: result.costUSD });

		if (!returns) return { text: result.finalOutput };

		let values: FlowValues;
		try {
			values = JSON.parse(result.finalOutput) as FlowValues;
		} catch {
			throw new Error(`${String(context.config.agent)} did not answer with JSON.`);
		}
		for (const [name, field] of Object.entries(returns)) {
			if (Array.isArray(field) && !field.includes(String(values[name]))) throw new Error(`${String(context.config.agent)} answered ${name} "${String(values[name])}", which is not one of ${field.join(', ')}.`);
		}
		const exitOn = context.config.exitOn;
		return typeof exitOn === 'string' ? exit(String(values[exitOn]), values) : values;
	},
};

/**
 * Reads a step's `returns` setting.
 *
 * @param value - Setting value.
 * @returns Fields by name, or null for a plain text reply.
 * @throws When a field is not a value type or a list of words.
 */
function readReturns(value: FlowValue | undefined): Record<string, ReturnField> | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw new Error('returns lists the fields the agent answers with.');
	for (const [name, field] of Object.entries(value)) {
		const ok = field === 'string' || field === 'number' || field === 'boolean'
			|| (Array.isArray(field) && field.length > 0 && field.every(item => typeof item === 'string' && /^[a-z][a-z0-9-]*$/.test(item)));
		if (!ok) throw new Error(`returns.${name} is "string", "number", "boolean", or a list of lower-case words.`);
	}
	return value as Record<string, ReturnField>;
}

/**
 * The strict JSON schema the model must answer with.
 *
 * @param returns - Fields by name.
 * @returns Agents SDK output type.
 */
function jsonSchema(returns: Record<string, ReturnField>) {
	return {
		type: 'json_schema' as const,
		name: 'flow_step_answer',
		strict: true,
		schema: {
			type: 'object' as const,
			properties: Object.fromEntries(Object.entries(returns).map(([name, field]) => [name, Array.isArray(field) ? { type: 'string', enum: field } : { type: field }])),
			required: Object.keys(returns),
			additionalProperties: false as const,
		},
	};
}
