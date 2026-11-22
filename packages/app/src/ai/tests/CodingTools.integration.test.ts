import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '@db3.ai/app/server';
import { Agent, AiConversation, AiMessage, AiRateLimitBucket, AiRateLimitReservation, AiRequest, CODING_AGENT_INSTRUCTIONS, LocalCodingWorkspace, codingTools, workspacePath, type AgentTool, type BaseAgentContext } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
let application: App;
let root: string;
const fetch = vi.fn<typeof globalThis.fetch>();

/** Supplies deterministic Responses API SSE while exercising the real SDK and framework. */
function streamResponse(output: unknown[], text = ''): Response {
	const response = { id: `resp_${Math.random()}`, object: 'response', created_at: 1, model: 'test-model', status: 'completed', output, usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
	const events: Record<string, unknown>[] = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }];
	for (const [index, item] of output.entries()) {
		events.push({ type: 'response.output_item.added', output_index: index, item });
		if (text) events.push({ type: 'response.output_text.delta', item_id: 'msg_test', output_index: index, content_index: 0, delta: text });
		events.push({ type: 'response.output_item.done', output_index: index, item });
	}
	events.push({ type: 'response.completed', response });
	return new Response(events.map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

/** Completes a model turn with a final assistant message. */
function textStream(text: string): Response {
	return streamResponse([{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], text);
}

/** Reads the provider input sent on one recorded request. */
function requestInput(index: number): Record<string, unknown>[] {
	return JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)).input;
}

/** Minimal application coding agent working in a temporary folder. */
class FolderCodingAgent extends Agent<BaseAgentContext & { root: string }> {
	protected override readonly maxTurns = null;
	/** Uses the shared coding instructions unchanged. */
	protected instructions(): string { return CODING_AGENT_INSTRUCTIONS; }
	/** Gives the model the native coding tools over a local folder. */
	protected tools(): AgentTool[] { return codingTools(new LocalCodingWorkspace(this.context.root), { signal: () => this.runSignal }); }
}

beforeAll(async () => {
	vi.stubEnv('OPENAI_AGENTS_TRACING_DISABLED', 'true');
	database = await createGeneratedTestDatabase('ai_coding');
	application = new App({ db: database.db, ai: { apiKey: 'synthetic-test-key', model: 'test-model', fetch, rateLimiter: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation);
});

beforeEach(async () => {
	fetch.mockReset();
	root = await mkdtemp(join(tmpdir(), 'db3-coding-'));
	await AiMessage.query().delete();
	await AiRequest.query().delete();
	await AiConversation.query().delete();
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

afterAll(async () => {
	try { await application?.close(); } finally {
		await database?.destroy();
		vi.unstubAllEnvs();
	}
});

describe('Coding tools', () => {
	it('edits files and runs commands through native shell and apply_patch calls, then replays them as native items', async () => {
		await writeFile(join(root, 'greeting.txt'), 'hello\n');
		fetch
			.mockResolvedValueOnce(streamResponse([{ type: 'apply_patch_call', id: 'apc_1', call_id: 'call_patch', status: 'completed', operation: { type: 'update_file', path: 'greeting.txt', diff: '@@\n-hello\n+hello world\n' } }]))
			.mockResolvedValueOnce(streamResponse([{ type: 'shell_call', id: 'sh_1', call_id: 'call_shell', status: 'completed', action: { commands: ['cat greeting.txt', 'exit 3'], timeout_ms: 5_000 } }]))
			.mockResolvedValueOnce(textStream('Updated the greeting.'));

		const result = await new FolderCodingAgent({ user: 'ada', scope: 'team-a', root }).run('Change the greeting.');

		expect(result.finalOutput).toBe('Updated the greeting.');
		expect(await readFile(join(root, 'greeting.txt'), 'utf8')).toBe('hello world\n');
		const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
		expect(first.tools.map((tool: { type: string; name?: string }) => tool.type === 'function' ? tool.name : tool.type)).toEqual(['shell', 'apply_patch', 'update_plan']);
		expect(requestInput(1)).toContainEqual(expect.objectContaining({ type: 'apply_patch_call_output', call_id: 'call_patch', status: 'completed' }));
		const shellOutput = requestInput(2).find(item => item.type === 'shell_call_output') as { output: { stdout: string; outcome: { exit_code?: number } }[] };
		expect(shellOutput.output.map(entry => [entry.stdout, entry.outcome.exit_code])).toEqual([['hello world\n', 0], ['', 3]]);

		const tools = await AiMessage.query().where('role', 'tool').where('toolState', 'success').orderBy('sequence').all();
		expect(tools.map(message => [message.toolName, (message.contentJson as { arguments: unknown }).arguments])).toEqual([
			['apply_patch', { type: 'update_file', path: 'greeting.txt', diff: '@@\n-hello\n+hello world\n' }],
			['shell', { commands: ['cat greeting.txt', 'exit 3'], timeoutMs: 5_000 }],
		]);

		fetch.mockResolvedValueOnce(textStream('Still updated.'));
		await new FolderCodingAgent({ user: 'ada', scope: 'team-a', root, conversationId: result.conversationId }).run('Is it done?');
		const replay = requestInput(3);
		expect(replay).toContainEqual(expect.objectContaining({ type: 'apply_patch_call', call_id: 'call_patch', operation: expect.objectContaining({ path: 'greeting.txt' }) }));
		expect(replay).toContainEqual(expect.objectContaining({ type: 'shell_call', call_id: 'call_shell' }));
		expect(replay).toContainEqual(expect.objectContaining({ type: 'shell_call_output', call_id: 'call_shell' }));
		expect(replay.some(item => item.type === 'function_call')).toBe(false);
	});

	it('reports a patch that does not apply back to the model without changing the file', async () => {
		await writeFile(join(root, 'greeting.txt'), 'hello\n');
		fetch
			.mockResolvedValueOnce(streamResponse([{ type: 'apply_patch_call', id: 'apc_2', call_id: 'call_bad', status: 'completed', operation: { type: 'update_file', path: '../outside.txt', diff: '@@\n-x\n+y\n' } }]))
			.mockResolvedValueOnce(textStream('That path is outside the workspace.'));

		await new FolderCodingAgent({ user: 'ada', scope: 'team-a', root }).run('Edit outside.');

		const output = requestInput(1).find(item => item.type === 'apply_patch_call_output') as { status: string; output: string };
		expect(output).toMatchObject({ status: 'failed' });
		expect(output.output).toContain('relative path inside the workspace');
	});
});

describe('Workspace paths', () => {
	it.each(['/etc/passwd', '../up.txt', 'a/../../b', 'C:/x', 'a//b', ''])('rejects %s', value => {
		expect(() => workspacePath(value)).toThrow('relative path inside the workspace');
	});

	it('normalizes ordinary relative paths', () => {
		expect(workspacePath('./src/app.ts')).toBe('src/app.ts');
		expect(workspacePath('src\\app.ts')).toBe('src/app.ts');
	});
});

describe('Local coding workspace', () => {
	it('stops a command at its time limit and reports a timeout', async () => {
		const workspace = new LocalCodingWorkspace(root);
		const [tool] = codingTools(workspace, { defaultTimeoutMs: 1_000 });
		const result = await (tool as unknown as { shell: { run(action: unknown): Promise<{ output: { outcome: { type: string } }[] }> } }).shell.run({ commands: ['sleep 5', 'echo never'] });
		expect(result.output.map(entry => entry.outcome.type)).toEqual(['timeout']);
	});
});
