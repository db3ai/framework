import { defineBlock } from '@db3.ai/app/flows';

/** Validates application meaning after the graph's basic string contract. */
export const normalizeTextBlock = defineBlock<{ text: string }, { text: string }>({
	type: 'notes.normalize', name: 'Normalize note',
	inputs: { text: { type: 'string', required: true } },
	outputs: { text: { type: 'string', required: true } },
	/** Rejects blank text and records a safe, value-free progress message. */
	async run(input, context) {
		const text = input.text.trim();
		if (!text) throw new Error('Note text cannot be blank.');
		await context.log('info', 'Note normalized');
		return { text };
	},
});
