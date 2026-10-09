import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '@db3.ai/app/server';
import { AgentOutputValidationError, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, registerQueuedAgent, AgentRunJob, type AgentPersistenceState } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { HelpAgent } from '../examples/HelpAgent';
import { Conversation } from '../examples/Conversation';

/** Exercises application completion validation through persisted tool evidence. */
class RequiredGuideAgent extends HelpAgent {
	/** Rejects premature final text unless this run actually read its saved guide. */
	protected override async afterFinalOutput(state: AgentPersistenceState): Promise<null> {
		const saved = await AiMessage.where({ aiRequest: String(state.rootAiRequest.id), toolName: 'read_help_guide', toolState: 'success' }).first();
		if (!saved) throw new AgentOutputValidationError('required_tool_missing', 'The required guide was not read.');
		return null;
	}
}

let database: GeneratedTestDatabase;
let application: App;
let storageRoot: string;
const fetch = vi.fn<typeof globalThis.fetch>();

/** Supplies deterministic Responses API SSE while exercising the real SDK and framework. */
function streamResponse(output: unknown[], text = '', model = 'test-model', serviceTier?: string, terminal: Record<string, unknown> = {}): Response {
	const response = { id: `resp_${output.length}_${text.length}`, object: 'response', created_at: 1, model, service_tier: serviceTier, status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }, ...terminal };
	const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
	for (const [index, item] of output.entries()) {
		events.push({ type: 'response.output_item.added', output_index: index, item });
		if (text) events.push({ type: 'response.output_text.delta', item_id: 'msg_test', output_index: index, content_index: 0, delta: text });
		events.push({ type: 'response.output_item.done', output_index: index, item });
	}
	events.push({ type: response.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response });
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

/** Completes one real SDK model turn with a deterministic assistant message. */
function textStream(text = 'Use the settings page.', model = 'test-model') {
	return streamResponse([{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], text, model);
}

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	database = await createGeneratedTestDatabase('agent_completion');
	storageRoot = await mkdtemp(join(tmpdir(), 'db3-agent-completion-'));
	application = new App({ db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch, models: { conversation: Conversation } }, queue: { driver: 'database', queueMonitor: false }, storage: { disks: { local: { driver: 'local', root: storageRoot } } } });
	await application.db.install(Conversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation, QueuedJob, FailedJob);
	await application.storage.put('help.md', 'Change your password on the settings page.');
	application.queue.registerJob(AgentRunJob);
	registerQueuedAgent('RequiredGuideAgent', RequiredGuideAgent);
});

beforeEach(async () => {
	fetch.mockReset();
	await AiRateLimitReservation.query().delete();
	await AiRateLimitBucket.query().delete();
	await QueuedJob.query().delete();
	await FailedJob.query().delete();
	await AiMessage.query().delete();
	await AiRequest.query().delete();
	await Conversation.query().delete();
});

afterAll(async () => {
	try { await application?.close(); } finally {
		await database?.destroy();
		if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
		vi.unstubAllEnvs();
	}
});

describe('agent completion diagnostics', () => {
	it('retains bounded completion evidence when validation rejects a queued run and a later retry succeeds', async () => {
		const queued = await new RequiredGuideAgent({ guidePath: 'help.md' }).queue('Private input sentinel.', { queue: 'completion-diagnostics', maxTries: 2 });
		fetch.mockResolvedValueOnce(textStream('Private final text sentinel.'));
		expect((await application.queue.workNextJob('completion-diagnostics'))?.status).toBe('released');
		const root = await AiRequest.findOrFail(queued.aiRequestId!);
		expect(root).toMatchObject({ status: 'failed', errorCode: 'required_tool_missing' });
		const first = await AiRequest.where({ parentAiRequest: queued.aiRequestId!, operation: 'agents.run.attempt' }).first();
		expect(first?.response).toMatchObject({
			lastResponseId: expect.any(String),
			completion: { modelTurns: 1, terminalStatus: 'completed', incompleteReason: null, toolCalls: 0, toolSuccesses: 0, toolErrors: 0 },
			outputValidation: { status: 'failed', code: 'required_tool_missing' },
		});
		expect(JSON.stringify(first?.response)).not.toContain('sentinel');
		expect(await AiMessage.where({ conversation: queued.conversationId, role: 'assistant' }).count()).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(1);
		const retry = await QueuedJob.where('queue', 'completion-diagnostics').first();
		expect(retry?.attempts).toBe(1);
		await retry!.assign({ availableAt: 0 }).save();
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'function_call', id: 'fc_required', call_id: 'call_required', name: 'read_help_guide', arguments: '{}' }])).mockResolvedValueOnce(textStream('Read the guide.'));
		expect((await application.queue.workNextJob('completion-diagnostics'))?.status).toBe('succeeded');
		expect(await AiRequest.findOrFail(queued.aiRequestId!)).toMatchObject({ status: 'completed', errorCode: null });
		expect((await AiRequest.findOrFail(String(first!.id))).response).toEqual(first!.response);
		const attempts = await AiRequest.where({ parentAiRequest: queued.aiRequestId!, operation: 'agents.run.attempt' }).all();
		expect(attempts).toHaveLength(2);
		expect(attempts.find(attempt => attempt.id !== first!.id)?.response).toMatchObject({ completion: { modelTurns: 2, toolCalls: 1, toolSuccesses: 1, toolErrors: 0 } });
		expect(await QueuedJob.where('queue', 'completion-diagnostics').count()).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it.each(['max_output_tokens', 'content_filter', 'private-provider-detail-sentinel'])('retains safe incomplete reason %s through real SDK validation failure', async reason => {
		fetch.mockResolvedValueOnce(streamResponse([{ type: 'message', id: 'msg_incomplete', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'Private output sentinel.', annotations: [] }] }], 'Private output sentinel.', 'test-model', undefined, { status: 'incomplete', incomplete_details: { reason }, metadata: { private: 'private-provider-detail-sentinel' } }));
		const queued = await new RequiredGuideAgent({ guidePath: 'help.md' }).queue('Private prompt sentinel.', { queue: 'incomplete-diagnostics', maxTries: 1 });
		expect((await application.queue.workNextJob('incomplete-diagnostics'))?.status).toBe('failed');
		const attempt = await AiRequest.where({ parentAiRequest: queued.aiRequestId!, operation: 'agents.run.attempt' }).first();
		expect(attempt?.response).toMatchObject({ completion: { modelTurns: 1, terminalStatus: 'incomplete', incompleteReason: reason === 'private-provider-detail-sentinel' ? 'unknown' : reason } });
		expect(JSON.stringify(attempt?.response)).not.toContain('sentinel');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

});
