import { describe, expect, it } from 'vitest';
import type { AgentDescription } from '@db3.ai/app/console';
import { agentName, applyEvent, canEdit, definitionFrom, formFor, type PlaygroundItem } from '../agentsView';

const support: AgentDescription = {
	name: 'support', kind: 'files+code', title: 'Support', description: null, model: 'gpt-5.4-mini', maxTurns: 6, reasoningEffort: null,
	context: [{ name: 'customerId', description: 'Who is asking' }], tools: ['find-order'], instructions: 'Help {{context.customerId}}.',
	overrides: ['tools'], path: 'db3/agents/support', revision: 'abc', className: 'SupportAgent',
} as AgentDescription;

describe('agents view', () => {
	it('edits what the files hold and leaves what code sets read-only', () => {
		expect(canEdit(support, 'instructions')).toBe(true);
		expect(canEdit(support, 'tools')).toBe(false);
		expect(canEdit({ ...support, path: null } as AgentDescription, 'title')).toBe(false);
		expect(canEdit(null, 'title')).toBe(false);
	});

	it('round-trips the form into an agent.json definition, leaving out empty fields', () => {
		const form = formFor(support);
		form.context.push({ name: ' ', description: '' });
		expect(definitionFrom(form)).toEqual({
			version: 1, name: 'support', title: 'Support', model: 'gpt-5.4-mini', maxTurns: 6,
			context: [{ name: 'customerId', description: 'Who is asking' }], tools: [{ kind: 'function', name: 'find-order' }],
		});
	});

	it('makes folder names from what someone typed', () => {
		expect(agentName('  Sales Lead Scorer! ')).toBe('sales-lead-scorer');
		expect(agentName('42 helper')).toBe('helper');
	});

	it('builds the playground transcript from streamed events', () => {
		const items: PlaygroundItem[] = [{ kind: 'user', text: 'Where is my order?' }];
		expect(applyEvent(items, { type: 'conversation.created', conversationId: 'c1' })).toBe('c1');
		applyEvent(items, { type: 'tool.calling', id: 't1', toolName: 'find-order', arguments: { id: 7 } });
		applyEvent(items, { type: 'tool.success', id: 't1', toolName: 'find-order', result: { status: 'shipped' } });
		applyEvent(items, { type: 'text.delta', delta: 'It ' });
		applyEvent(items, { type: 'text.delta', delta: 'shipped.' });
		applyEvent(items, { type: 'message.completed', content: 'It shipped.' });
		applyEvent(items, { type: 'run.error', error: { message: 'Out of credit' } });
		expect(items).toEqual([
			{ kind: 'user', text: 'Where is my order?' },
			{ kind: 'tool', id: 't1', name: 'find-order', state: 'done', detail: '{"status":"shipped"}' },
			{ kind: 'assistant', text: 'It shipped.', done: true },
			{ kind: 'error', text: 'Out of credit' },
		]);
	});
});
