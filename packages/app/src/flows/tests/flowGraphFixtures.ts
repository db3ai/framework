import { ulid } from '@db3.ai/pure/ulid';

import { defineBlock, exit, type FlowGraphDefinition } from '../index';

/** Sorts a message into spam or lead, the way an agent step would. */
export const classifyBlock = defineBlock<{ message: string }, { kind: string; score: number }>({
	type: 'test.classify',
	name: 'Classify',
	inputs: { message: { type: 'string', required: true } },
	outputs: { kind: { type: 'string', required: true }, score: { type: 'number', required: true } },
	exits: ['spam', 'lead'],
	run: input => input.message.includes('casino')
		? exit('spam', { kind: 'spam', score: 0 })
		: exit('lead', { kind: 'lead', score: 87 }),
});

/** Records a line of text and hands it back. */
export const recordBlock = defineBlock<{ label: string }, { saved: string }>({
	type: 'test.record',
	name: 'Record',
	inputs: { label: { type: 'string', required: true } },
	outputs: { saved: { type: 'string', required: true } },
	run: input => ({ saved: input.label }),
});

/** Always fails, like a chat service that is down. */
export const failBlock = defineBlock<Record<string, never>, { sent: boolean }>({
	type: 'test.fail',
	name: 'Page team',
	inputs: {},
	outputs: { sent: { type: 'boolean', required: true } },
	run: () => {
		throw new Error('Chat service is down.');
	},
});

export const graphTestBlocks = [classifyBlock, recordBlock, failBlock];

/**
 * A lead intake flow: classify, then spam goes to a block list, and a lead goes to
 * the CRM and a reply side by side before the team is paged. Paging fails and takes
 * its error exit to an alert.
 *
 * @returns Flow file contents.
 */
export function leadIntakeFlow(): FlowGraphDefinition {
	return {
		schemaVersion: 2,
		id: ulid(),
		name: 'lead-intake',
		title: 'Lead intake',
		inputs: {
			email: { type: 'string', required: true },
			message: { type: 'string', required: true },
		},
		outputs: {
			kind: { type: 'string', required: true, value: '{{classify.kind}}' },
			reply: { type: 'string', value: '{{reply.saved}}' },
		},
		triggers: {
			contact: { type: 'trigger.form', config: { title: 'Contact us' } },
		},
		steps: {
			classify: { type: 'test.classify', config: { message: '{{input.message}}' } },
			block: { type: 'test.record', title: 'Add to block list', config: { label: 'blocked {{input.email}}' } },
			crm: { type: 'test.record', title: 'Add to CRM', config: { label: 'crm {{input.email}} scored {{classify.score}}' } },
			reply: { type: 'test.record', title: 'Reply', config: { label: 'reply to {{input.email}}' } },
			page: { type: 'test.fail' },
			alert: { type: 'test.record', config: { label: 'paging failed: {{page.error.message}}' } },
		},
		edges: [
			['input', 'classify'],
			['classify.spam', 'block'],
			['classify.lead', 'crm'],
			['classify.lead', 'reply'],
			['crm', 'page'],
			['reply', 'page'],
			['page.error', 'alert'],
		],
		layout: { classify: [0, 0], block: [240, -120], crm: [240, 0], reply: [240, 120], page: [480, 0], alert: [720, 0] },
	};
}
