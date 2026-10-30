import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as ai from '@db3.ai/app/ai';
import { describeAgents } from '../commands/agents';

let folder: string;

const lookup = ai.defineTool({ name: 'lookup_order', description: 'Find an order.', parameters: z.object({ id: z.string() }), run: ({ id }) => ({ id }) });

/** A plain class agent, as apps write them today. */
class ReportAgent extends ai.Agent {
	protected readonly agentName = 'reports';
	protected readonly model = 'gpt-test';
	async instructions() { return 'Write reports.'; }
	protected tools() { return []; }
}

beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), 'db3-agents-cli-'));
	const store = new ai.FileAgentDefinitionStore(join(folder, 'db3/agents'));
	await store.write({ definition: { version: 1, name: 'support', title: 'Support', tools: [{ kind: 'function', name: 'lookup_order' }] }, instructions: 'Help.' }, { expectedRevision: null });
	await store.write({ definition: { version: 1, name: 'faq' }, instructions: 'Answer questions.' }, { expectedRevision: null });
});

afterAll(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe('agents:list', () => {
	it('describes agents from files, from defineAgent and from plain classes, marking what code sets', async () => {
		const Strict = ai.defineAgent({ name: 'support', from: 'support', model: 'gpt-strict', instructions: ({ base }) => `${base} Be strict.` });
		const Greeter = ai.defineAgent({ name: 'greeter', instructions: 'Greet people.', tools: [lookup] });
		const agents = await describeAgents(folder, { agents: [Strict, Greeter, ReportAgent], tools: [lookup], ai });
		expect(agents.map(item => [item.name, item.kind])).toEqual([['faq', 'files'], ['greeter', 'code'], ['reports', 'class'], ['support', 'files+code']]);
		expect(agents.find(item => item.name === 'support')).toMatchObject({ title: 'Support', model: 'gpt-strict', tools: ['lookup_order'], instructions: null, overrides: ['model', 'instructions'], path: 'db3/agents/support' });
		expect(agents.find(item => item.name === 'greeter')).toMatchObject({ instructions: 'Greet people.', tools: ['lookup_order'], path: null });
		expect(agents.find(item => item.name === 'reports')).toMatchObject({ model: 'gpt-test', className: 'ReportAgent', instructions: null });
	});
});
