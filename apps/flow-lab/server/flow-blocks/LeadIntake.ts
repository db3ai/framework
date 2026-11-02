import { defineBlock, exit } from '@db3.ai/app/flows';

/**
 * Demo blocks for the lead intake flow (file shape 2). They stand in for an agent,
 * a CRM and a chat service so the flow runs end to end without accounts.
 */

/** Sorts a message into spam or lead, the way a classifier agent would. */
export const ClassifyLead = defineBlock<{ message: string }, { kind: string; reason: string }>({
	type: 'lead.classify',
	name: 'Classify message',
	description: 'Demo classifier: spam when the message mentions casino or crypto, otherwise a lead.',
	inputs: { message: { type: 'string', required: true } },
	outputs: { kind: { type: 'string', required: true }, reason: { type: 'string', required: true } },
	exits: ['spam', 'lead'],
	run: ({ message }) => /casino|crypto/i.test(message)
		? exit('spam', { kind: 'spam', reason: 'Mentions casino or crypto.' })
		: exit('lead', { kind: 'lead', reason: 'Reads like a genuine enquiry.' }),
});

/** Records a sender on the block list. */
export const BlockSender = defineBlock<{ email: string }, { blocked: string }>({
	type: 'lead.block-sender',
	name: 'Block sender',
	description: 'Demo: adds the sender to a block list.',
	inputs: { email: { type: 'string', required: true } },
	outputs: { blocked: { type: 'string', required: true } },
	run: ({ email }) => ({ blocked: email.toLowerCase() }),
});

/** Adds a lead to a CRM. */
export const AddToCrm = defineBlock<{ email: string; name: string }, { crmId: string; owner: string }>({
	type: 'lead.add-to-crm',
	name: 'Add to CRM',
	description: 'Demo: returns a made-up CRM id and owner.',
	inputs: { email: { type: 'string', required: true }, name: { type: 'string' } },
	outputs: { crmId: { type: 'string', required: true }, owner: { type: 'string', required: true } },
	run: ({ email }) => ({ crmId: `crm_${email.split('@')[0]}`, owner: 'Sam' }),
});

/** Sends a reply. */
export const SendReply = defineBlock<{ to: string; text: string }, { sent: boolean }>({
	type: 'mail.demo-reply',
	name: 'Send reply',
	description: 'Demo: pretends to email the reply.',
	inputs: { to: { type: 'string', required: true }, text: { type: 'string', required: true } },
	outputs: { sent: { type: 'boolean', required: true } },
	run: async (_input, context) => {
		await context.log('info', 'Reply sent (demo).');
		return { sent: true };
	},
});

/** Pages the team; fails when the text says so, to show the error exit. */
export const PageTeam = defineBlock<{ text: string }, { posted: boolean }>({
	type: 'slack.demo-post',
	name: 'Page the team',
	description: 'Demo: posts to a channel. Fails when the text contains "fail", to show the error exit.',
	inputs: { text: { type: 'string', required: true } },
	outputs: { posted: { type: 'boolean', required: true } },
	run: ({ text }) => {
		if (/fail/i.test(text)) throw new Error('Chat service answered 503.');
		return { posted: true };
	},
});

export const leadIntakeBlocks = [ClassifyLead, BlockSender, AddToCrm, SendReply, PageTeam];
