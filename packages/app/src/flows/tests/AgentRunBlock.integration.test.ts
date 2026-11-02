import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from '@db3.ai/pure/ulid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AiMessage, AiRateLimitBucket, AiRateLimitReservation, AiRequest, FileAgentDefinitionStore } from '../../ai';
import { Conversation } from '../../ai/examples/Conversation';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { FailedJob, QueuedJob } from '../../queue';
import { App } from '../../server';
import { FLOW_MODELS, FileFlowDefinitionStore, FlowDefinitionError, FlowRun, Flows, FlowStepJob, FlowStepRun, type FlowGraphDefinition } from '../index';
import { recordBlock } from './flowGraphFixtures';

class AgentFlowApp extends App {
	flows!: Flows;
}

const fetch = vi.fn<typeof globalThis.fetch>();
let database: GeneratedTestDatabase;
let folder: string;
let app: AgentFlowApp;

/** One Responses API reply carrying the given text, streamed. */
function reply(text: string): Response {
	const item = { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
	const response = { id: `resp_${text.length}`, object: 'response', created_at: 1, model: 'test-model', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
	const events = [
		{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
		{ type: 'response.output_item.added', output_index: 0, item },
		{ type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, content_index: 0, delta: text },
		{ type: 'response.output_item.done', output_index: 0, item },
		{ type: 'response.completed', response },
	];
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

function classifierFlow(): FlowGraphDefinition {
	return {
		schemaVersion: 2,
		id: ulid(),
		name: 'agent-intake',
		inputs: { message: { type: 'string', required: true } },
		outputs: { reason: { type: 'string', value: '{{classify.reason}}' } },
		steps: {
			classify: { type: 'agent.run', config: { agent: 'lead-classifier', message: 'Sort this: {{input.message}}', returns: { kind: ['spam', 'lead'], reason: 'string' }, exitOn: 'kind' } },
			block: { type: 'test.record', config: { label: 'blocked: {{classify.reason}}' } },
			welcome: { type: 'test.record', config: { label: 'welcome' } },
		},
		edges: [['input', 'classify'], ['classify.spam', 'block'], ['classify.lead', 'welcome']],
	};
}

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	database = await createGeneratedTestDatabase('flows_agent');
	folder = await mkdtemp(join(tmpdir(), 'db3-flow-agent-'));
	app = new AgentFlowApp({
		directory: folder,
		db: database.db,
		ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch, models: { conversation: Conversation } },
		queue: { queue: 'flows', retryDelaySeconds: 0, queueMonitor: false, jobResolver: async ({ jobName }) => jobName === FlowStepJob.jobName ? FlowStepJob : null },
	});
	await app.db.install(Conversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob, ...FLOW_MODELS);
	await new FileAgentDefinitionStore(join(folder, 'db3/agents')).write({ definition: { version: 1, name: 'lead-classifier', model: 'test-model' }, instructions: 'Sort messages into spam or lead.' }, { expectedRevision: null });
	app.flows = new Flows({ queue: app.queue, definitions: new FileFlowDefinitionStore({ root: join(folder, 'db3/flows') }), blocks: [recordBlock], queueName: 'flows', maxTries: 1 });
}, 60_000);

afterAll(async () => {
	vi.unstubAllEnvs();
	await app?.close();
	await database?.destroy();
	await rm(folder, { recursive: true, force: true });
});

describe('agent.run step', () => {
	it('asks the agent for JSON of the returns shape and takes the exit it chose', async () => {
		const flow = classifierFlow();
		await app.flows.saveDefinition(flow);
		fetch.mockResolvedValueOnce(reply('{"kind":"spam","reason":"Mentions a casino."}'));

		const run = await app.flows.start('agent-intake', { message: 'Win at the casino' });
		while (await app.queue.processNextJob('flows')) { /* drain */ }

		const finished = await FlowRun.findOrFail(run.id!);
		expect(finished.status).toBe('completed');
		expect(finished.output).toEqual({ reason: 'Mentions a casino.' });
		const steps = Object.fromEntries((await FlowStepRun.where('run', finished).all()).map(step => [step.blockId, step]));
		expect(steps.classify).toMatchObject({ exit: 'spam', output: { kind: 'spam', reason: 'Mentions a casino.' } });
		expect(steps.block.output).toEqual({ saved: 'blocked: Mentions a casino.' });
		expect(steps.welcome.status).toBe('skipped');

		const request = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
		expect(request.input.at(-1).content).toBe('Sort this: Win at the casino');
		expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true, schema: { properties: { kind: { type: 'string', enum: ['spam', 'lead'] } } } });
	});

	it('fails the step when the agent answers outside the allowed words', async () => {
		fetch.mockResolvedValueOnce(reply('{"kind":"maybe","reason":"Unsure."}'));
		const run = await app.flows.start('agent-intake', { message: 'Hmm' });
		while (await app.queue.processNextJob('flows')) { /* drain */ }
		const finished = await FlowRun.findOrFail(run.id!);
		expect(finished.status).toBe('failed');
		expect(finished.error?.message).toMatch(/not one of spam, lead/);
	});

	it('refuses exitOn that does not name a list of words', async () => {
		const flow = classifierFlow();
		flow.steps.classify.config = { ...flow.steps.classify.config, exitOn: 'reason' };
		await expect(app.flows.saveDefinition(flow)).rejects.toThrow(FlowDefinitionError);
	});
});
