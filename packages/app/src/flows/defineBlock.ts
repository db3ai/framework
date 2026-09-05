import type { FlowBlockDefinition, FlowValues } from './contracts';

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
