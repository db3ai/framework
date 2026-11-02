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

/** A class agent that needs real context to construct, like one that loads saved records. */
class ArticleAgent extends ai.Agent {
	static readonly agentName = 'article-writer';
	protected readonly agentName = 'article-writer';
	constructor(context: Record<string, unknown>) { if (!context.article) throw new Error('Article agents need a saved article.'); super(context); }
	async instructions() { return 'Write articles.'; }
	protected tools() { return []; }
}

/** The same, without a static name. */
class DraftAgent extends ArticleAgent {
	static readonly agentName = undefined as unknown as string;
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

	it('still lists a class agent that needs real context to construct, by its static name or class name', async () => {
		const agents = await describeAgents(folder, { agents: [ArticleAgent, DraftAgent], tools: [], ai });
		expect(agents.filter(item => item.kind === 'class').map(item => [item.name, item.className, item.model])).toEqual([['article-writer', 'ArticleAgent', null], ['DraftAgent', 'DraftAgent', null]]);
	});
});
