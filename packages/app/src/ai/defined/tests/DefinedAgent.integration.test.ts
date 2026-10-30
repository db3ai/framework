import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { App } from '@db3.ai/app/server';
import { AgentDefinitionConflictError, agentFiles, agentFromFiles, AiMessage, AiRateLimitBucket, AiRateLimitReservation, AiRequest, DefinedAgent, FileAgentDefinitionStore, defineAgent, defineTool, registerAgentTools } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Conversation } from '../../examples/Conversation';

let database: GeneratedTestDatabase;
let application: App;
let folder: string;
const fetch = vi.fn<typeof globalThis.fetch>();
const refunds: { orderId: string; user: unknown }[] = [];

/** Deterministic Responses API events, as in the framework's own agent tests. */
function streamResponse(output: unknown[], text = ''): Response {
	const response = { id: `resp_${output.length}_${text.length}`, object: 'response', created_at: 1, model: 'test-model', status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
	const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
	for (const [index, item] of output.entries()) {
		events.push({ type: 'response.output_item.added', output_index: index, item });
		if (text) events.push({ type: 'response.output_text.delta', item_id: 'msg_test', output_index: index, content_index: 0, delta: text });
		events.push({ type: 'response.output_item.done', output_index: index, item });
	}
	events.push({ type: 'response.completed', response });
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

const issueRefund = defineTool({
	name: 'issue_refund',
	title: 'Issue refund',
	description: 'Refund an order in full.',
	parameters: z.object({ orderId: z.string() }),
	run: ({ orderId }, { context }) => { refunds.push({ orderId, user: context.user }); return { ok: true, refunded: orderId }; },
});

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	database = await createGeneratedTestDatabase('defined_agents');
	folder = await mkdtemp(join(tmpdir(), 'db3-defined-agents-'));
	application = new App({ directory: folder, db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch, models: { conversation: Conversation } } });
	await application.db.install(Conversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation);
	registerAgentTools([issueRefund]);
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await application?.close();
	await database?.destroy();
	await rm(folder, { recursive: true, force: true });
});

describe('agents defined as files', () => {
	const store = () => new FileAgentDefinitionStore(join(folder, 'db3/agents'));

	it('saves an agent as two stable files and refuses a save based on an old copy', async () => {
		const saved = await store().write({ definition: { version: 1, name: 'support', title: 'Support', model: 'test-model', context: [{ name: 'customerId', description: 'Signed-in customer' }], tools: [{ kind: 'function', name: 'issue_refund' }] }, instructions: 'Help customers.\r\nThe customer is {{context.customerId}}.' }, { expectedRevision: null });
		expect(await readFile(join(folder, 'db3/agents/support/agent.json'), 'utf8')).toBe('{\n\t"version": 1,\n\t"name": "support",\n\t"title": "Support",\n\t"model": "test-model",\n\t"context": [\n\t\t{\n\t\t\t"name": "customerId",\n\t\t\t"description": "Signed-in customer"\n\t\t}\n\t],\n\t"tools": [\n\t\t{\n\t\t\t"kind": "function",\n\t\t\t"name": "issue_refund"\n\t\t}\n\t]\n}\n');
		expect(await readFile(join(folder, 'db3/agents/support/instructions.md'), 'utf8')).toBe('Help customers.\nThe customer is {{context.customerId}}.\n');
		expect((await store().read('support'))?.revision).toBe(saved.revision);
		await expect(store().write({ definition: saved.definition, instructions: 'Changed.' }, { expectedRevision: 'stale' })).rejects.toBeInstanceOf(AgentDefinitionConflictError);
		await expect(store().write({ definition: { version: 1, name: 'Bad Name' }, instructions: '' }, { expectedRevision: null })).rejects.toThrow('lower case');
		expect((await store().list()).map(item => item.definition.name)).toEqual(['support']);
	});

	it('runs from its files with placeholders filled and its function tools bound to the trusted context', async () => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'issue_refund', arguments: '{"orderId":"A-17"}' }]))
			.mockResolvedValueOnce(streamResponse([{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Refunded A-17.', annotations: [] }] }], 'Refunded A-17.'));
		const result = await new DefinedAgent('support', { user: 'ada', scope: 'shop', customerId: 'cus_9' }).run('Refund order A-17.');
		expect(result.finalOutput).toBe('Refunded A-17.');
		expect(refunds).toEqual([{ orderId: 'A-17', user: 'ada' }]);
		const first = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
		expect(first.instructions).toBe('Help customers.\nThe customer is cus_9.\n');
		expect(first.tools.map((item: { name: string }) => item.name)).toEqual(['issue_refund']);
		expect((await Conversation.query().where('id', result.conversationId).first())?.agent).toBe('support');
	});

	it('gives hosts that save elsewhere the same files and revisions as the folder store', async () => {
		const stored = (await store().read('support'))!;
		const files = agentFiles({ definition: stored.definition, instructions: stored.instructions });
		expect(files.revision).toBe(stored.revision);
		expect(agentFromFiles('support', files.json, files.instructions)).toEqual(stored);
		expect(() => agentFromFiles('other', files.json, files.instructions)).toThrow('the folder and the name must match');
	});

	it('says which tool is missing and which agent has no files', async () => {
		await store().write({ definition: { version: 1, name: 'orphan', tools: [{ kind: 'function', name: 'nowhere' }] }, instructions: 'Hi.' }, { expectedRevision: null });
		await expect(new DefinedAgent('orphan', { user: 'ada' }).run('Hello')).rejects.toThrow("Agent orphan uses the tool nowhere, which isn't listed in server/agents/index.ts.");
		expect(() => new DefinedAgent('ghost', { user: 'ada' })).toThrow('There is no agent "ghost" in db3/agents.');
	});

	it('defines agents in code with defineAgent, alone or on top of the files', async () => {
		const Greeter = defineAgent({ name: 'greeter', model: 'test-model', instructions: 'Greet {{context.who}} warmly.' });
		const Strict = defineAgent({ name: 'strict-support', from: 'support', instructions: ({ base }) => `${base}Never refund over 100.`, tools: [] });
		expect(Strict.overrides).toEqual(['instructions', 'tools']);
		fetch.mockReset();
		fetch.mockImplementation(async () => streamResponse([{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hi!', annotations: [] }] }], 'Hi!'));
		await new Greeter({ user: 'ada', who: 'Max' }).run('Hello');
		expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).instructions).toBe('Greet Max warmly.');
		const result = await new Strict({ user: 'ada', customerId: 'cus_2' }).run('Hello');
		const body = JSON.parse(String(fetch.mock.calls[1]![1]?.body));
		expect(body.instructions).toBe('Help customers.\nThe customer is cus_2.\nNever refund over 100.');
		expect(body.tools ?? []).toEqual([]);
		expect((await Conversation.query().where('id', result.conversationId).first())?.agent).toBe('strict-support');
		expect(() => defineAgent({ name: 'empty' })).toThrow('needs instructions');
	});
});
