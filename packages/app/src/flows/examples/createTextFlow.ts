import type { FlowDefinition } from '@db3.ai/app/flows';
import { ulid } from '@db3.ai/pure/ulid';

/** Creates a two-block sequential definition with stable IDs retained on edits. */
export function createTextFlow(): FlowDefinition {
	const normalize = ulid();
	const uppercase = ulid();
	return {
		schemaVersion: 1, id: ulid(), name: 'Normalize note text',
		inputs: { text: { type: 'string', required: true } }, outputs: { text: { type: 'string', required: true } },
		blocks: [{ id: normalize, type: 'notes.normalize', position: { x: 0, y: 0 } }, { id: uppercase, type: 'notes.uppercase', config: { prefix: '' }, position: { x: 250, y: 0 } }],
		connections: [{ id: ulid(), sourceBlockId: normalize, sourcePort: 'text', targetBlockId: uppercase, targetPort: 'text' }],
	};
}
