import { tool } from '@openai/agents';
import type { z } from 'zod';
import type { AgentTool, BaseAgentContext } from '../contracts/Agent';

/** A function an agent can call, written once in `server/tools` and offered in the console. */
export interface FunctionToolSpec<TParameters extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
	/** Name the model calls, such as `issue_refund`. */
	name: string;
	/** Title shown in the console and in a conversation; defaults to the name. */
	title?: string;
	/** What it does, for the model and the console. */
	description: string;
	/** Arguments the model passes, checked before `run`. */
	parameters: TParameters;
	/**
	 * Does the work. The agent's context holds trusted values the caller set, such as the user;
	 * the model only chooses the arguments.
	 */
	run(args: z.infer<TParameters>, options: { context: BaseAgentContext & Record<string, unknown> }): unknown | Promise<unknown>;
}

/** A tool made with {@link defineTool}. */
export type FunctionTool = Readonly<FunctionToolSpec> & { readonly kind: 'function' };

const registered = new Map<string, FunctionTool>();

/**
 * Defines a function tool that agents made in the console can use. Export it from
 * `server/tools/` and list it in `server/agents/index.ts`; the console offers it by name.
 *
 * @example
 * ```ts
 * export default defineTool({
 * 	name: 'issue_refund',
 * 	description: 'Refund an order in full.',
 * 	parameters: z.object({ orderId: z.string() }),
 * 	run: ({ orderId }, { context }) => refunds.issue(orderId, context.user),
 * });
 * ```
 */
export function defineTool<TParameters extends z.ZodObject<z.ZodRawShape>>(spec: FunctionToolSpec<TParameters>): FunctionTool {
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)) throw new Error(`Tool names use letters, digits, dashes and underscores; "${spec.name}" does not.`);
	return Object.freeze({ ...spec, kind: 'function' as const }) as unknown as FunctionTool;
}

/**
 * Makes function tools available to defined agents by name. Apps call it once at boot with the
 * `tools` array from `server/agents/index.ts`; the `db3` command does it for you.
 *
 * @param tools - Tools made with {@link defineTool}.
 */
export function registerAgentTools(tools: readonly FunctionTool[]): void {
	for (const item of tools) {
		const existing = registered.get(item.name);
		if (existing && existing !== item) throw new Error(`Two tools are named ${item.name}.`);
		registered.set(item.name, item);
	}
}

/** The function tools registered so far, sorted by name. */
export function registeredAgentTools(): FunctionTool[] {
	return [...registered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Turns a function tool into one the agent runtime calls, bound to one run's context.
 *
 * @param spec - Registered tool.
 * @param context - The agent's context.
 */
export function agentToolFor(spec: FunctionTool, context: BaseAgentContext & Record<string, unknown>): AgentTool {
	return Object.assign(tool({
		name: spec.name,
		description: spec.description,
		parameters: spec.parameters,
		/** Runs the app's function with the trusted context, never values the model made up. */
		execute: async args => spec.run(args as never, { context }),
	}), { title: spec.title ?? spec.name, description: spec.description }) as AgentTool;
}

/** Looks up a registered tool by name. */
export function registeredAgentTool(name: string): FunctionTool | null {
	return registered.get(name) ?? null;
}
