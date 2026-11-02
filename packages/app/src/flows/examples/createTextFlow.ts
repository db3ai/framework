import type { FlowGraphDefinition } from '@db3.ai/app/flows';
import { ulid } from '@db3.ai/pure/ulid';

/** Creates a two-step flow: normalize the text, then uppercase it. */
export function createTextFlow(): FlowGraphDefinition {
	return {
		schemaVersion: 2, id: ulid(), name: 'normalize-note',
		inputs: { text: { type: 'string', required: true } },
		outputs: { text: { type: 'string', value: '{{uppercase.text}}' } },
		steps: {
			normalize: { type: 'notes.normalize', config: { text: '{{input.text}}' } },
			uppercase: { type: 'notes.uppercase', config: { text: '{{normalize.text}}', prefix: '' } },
		},
		edges: [['input', 'normalize'], ['normalize', 'uppercase']],
	};
}
