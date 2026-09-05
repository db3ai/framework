import { defineBlock } from '@db3.ai/app/flows';

/** Formats validated text without an external provider or irreversible side effect. */
export const uppercaseTextBlock = defineBlock<{ text: string }, { text: string }, { prefix: string }>({
	type: 'notes.uppercase', name: 'Uppercase note',
	inputs: { text: { type: 'string', required: true } },
	outputs: { text: { type: 'string', required: true } },
	config: { prefix: { type: 'string', default: '' } },
	/** Applies the snapshotted configuration to one deterministic output. */
	run(input, context) { return { text: `${context.config.prefix}${input.text.toUpperCase()}` }; },
});
