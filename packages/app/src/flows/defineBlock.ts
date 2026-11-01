import { FLOW_EXIT, type FlowBlockDefinition, type FlowExit, type FlowValues } from './contracts';

/**
 * Preserves generic block input, output, and configuration types while exposing
 * the plain one-file block contract used by the runtime.
 *
 * @param definition - Executable block definition.
 * @returns The same definition with its inferred generic types intact.
 *
 * @example
 * export default defineBlock({
 * 	type: 'text.uppercase',
 * 	name: 'Uppercase',
 * 	inputs: { text: { type: 'string', required: true } },
 * 	outputs: { text: { type: 'string', required: true } },
 * 	run: input => ({ text: input.text.toUpperCase() }),
 * });
 */
export function defineBlock<
	TInput extends FlowValues,
	TOutput extends FlowValues,
	TConfig extends FlowValues = FlowValues,
>(definition: FlowBlockDefinition<TInput, TOutput, TConfig>): FlowBlockDefinition<TInput, TOutput, TConfig> {
	return definition;
}

/**
 * Returns a block result that takes one of the block's named exits.
 *
 * @param name - Exit name declared by the block's `exits` or `exitsFor`.
 * @param values - Output values the step returns.
 * @returns Result the runtime routes through that exit.
 *
 * @example
 * export default defineBlock({
 * 	type: 'orders.check-stock',
 * 	name: 'Check stock',
 * 	exits: ['in-stock', 'sold-out'],
 * 	inputs: { sku: { type: 'string', required: true } },
 * 	outputs: { count: { type: 'number' } },
 * 	run: async ({ sku }) => {
 * 		const count = await stock(sku);
 * 		return exit(count > 0 ? 'in-stock' : 'sold-out', { count });
 * 	},
 * });
 */
export function exit<TOutput extends FlowValues>(name: string, values: TOutput): FlowExit<TOutput> {
	return { [FLOW_EXIT]: name, values };
}

/**
 * Narrows a block result to an exit made with {@link exit}.
 *
 * @param value - Value returned by a block's `run`.
 * @returns True when the result names an exit.
 */
export function isFlowExit(value: unknown): value is FlowExit {
	return Boolean(value && typeof value === 'object' && FLOW_EXIT in value);
}
