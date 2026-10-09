import { defineBlock, type FlowValues } from '@db3.ai/app/flows';

type NameValues = FlowValues & {
	name: string;
};

/**
 * Validates and normalizes the name used by the greeting flow.
 */
export default defineBlock<NameValues, NameValues>({
	type: 'validation.require-name',
	name: 'Require Name',
	description: 'Rejects blank names and trims surrounding whitespace.',
	inputs: {
		name: {
			type: 'string',
			required: true,
		},
	},
	outputs: {
		name: {
			type: 'string',
			required: true,
		},
	},
	/**
	 * Rejects blank names and emits a normalized value.
	 *
	 * @param input - Candidate name.
	 * @returns Trimmed name.
	 */
	run(input) {
		const name = input.name.trim();

		if (!name) {
			throw new Error('A non-empty name is required.');
		}

		return { name };
	},
});
