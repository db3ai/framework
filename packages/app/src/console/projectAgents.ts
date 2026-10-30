import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { AgentDefinitionConflictError, FileAgentDefinitionStore } from '../ai/defined/FileAgentDefinitionStore';
import type { ConsoleAgentLogs, ConsoleAgents, ConsoleAgentTool, AgentDescription } from './ConsoleAgents';
import { ConsoleError } from './ConsoleError';

/** How long listing the app's agents may take before it is reported as stuck. */
const LIST_TIMEOUT_MS = 60_000;
/** Longest playground run. */
const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * The Agents screens for an app checked out on this machine. Agent files are read and saved here
 * with the framework's store; anything that needs the app's own code (class agents, its tools,
 * a playground run) goes through the app's `db3 agents:list` and `db3 agents:run` commands, run
 * in its folder. Nothing is served by the app.
 *
 * @param directory - The app's folder.
 * @param logs - Its conversation and request tables, when its database is reachable.
 */
export function projectAgents(directory: string, logs: ConsoleAgentLogs | null): ConsoleAgents {
	const store = new FileAgentDefinitionStore(join(directory, 'db3', 'agents'));
	return {
		async list() {
			const output = await db3(directory, ['agents:list', '--json'], LIST_TIMEOUT_MS);
			const parsed = lastJson(output.stdout) as { agents?: AgentDescription[]; tools?: ConsoleAgentTool[] } | null;
			if (!parsed || !Array.isArray(parsed.agents)) throw new ConsoleError(`Couldn't list this app's agents. ${tail(output.stderr || output.stdout) || 'Its db3 command gave no answer.'}`, 502);
			return { agents: parsed.agents, tools: parsed.tools ?? [] };
		},
		async save(input, expectedRevision) {
			try {
				const saved = await store.write(input, { expectedRevision });
				return { revision: saved.revision, path: `db3/agents/${saved.path}` };
			} catch (error) {
				if (error instanceof AgentDefinitionConflictError && expectedRevision === null) throw new ConsoleError(`There's already an agent called ${String((input.definition as { name?: unknown }).name)}. Pick another name.`, 409);
				if (error instanceof AgentDefinitionConflictError) throw new ConsoleError('Someone changed this agent since you opened it. Reload it to see their version.', 409);
				throw new ConsoleError(error instanceof Error ? error.message : String(error), 400);
			}
		},
		async run(name, input, emit, signal) {
			const args = ['agents:run', name, '--message', input.message];
			if (input.context && Object.keys(input.context).length) args.push('--context', JSON.stringify(input.context));
			if (input.conversationId) args.push('--conversation', input.conversationId);
			// The run is over at its last event; the process may still take a few seconds to flush
			// traces and exit, which the caller shouldn't wait for.
			let sawEnd = false;
			let ended = () => {};
			const end = new Promise<void>(resolveEnd => { ended = resolveEnd; });
			const finished = db3(directory, args, RUN_TIMEOUT_MS, signal, line => {
				const event = parseLine(line);
				if (!event || sawEnd) return;
				if (event.type === 'run.completed' || event.type === 'run.error') { sawEnd = true; ended(); }
				emit(event);
			});
			finished.catch(() => {});
			const output = await Promise.race([finished, end.then(() => null)]);
			if (output && !sawEnd) emit({ type: 'run.error', conversationId: null, aiRequestId: null, traceId: null, error: { message: tail(output.stderr) || 'The run stopped without finishing.' } });
		},
		conversations: async (name, limit) => logs ? logs.conversations(name, limit) : [],
		messages: async conversationId => logs ? logs.messages(conversationId) : [],
		lastRun: async name => logs ? logs.lastRun(name) : null,
	};
}

/** Runs the app's `db3` command in its folder, handing each stdout line on as it arrives. */
function db3(directory: string, args: string[], timeoutMs: number, signal?: AbortSignal, line?: (text: string) => void): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn('npx', ['--no-install', 'db3', ...args], { cwd: directory, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let pending = '';
		const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
		const stop = () => child.kill('SIGTERM');
		signal?.addEventListener('abort', stop, { once: true });
		child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
			if (!line) return;
			pending += chunk;
			const lines = pending.split('\n');
			pending = lines.pop() ?? '';
			for (const item of lines) line(item);
		});
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-20_000); });
		child.on('error', error => { clearTimeout(timer); reject(new ConsoleError(`Couldn't run this app's db3 command: ${error.message}`, 502)); });
		child.on('close', code => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', stop);
			if (line && pending) line(pending);
			resolvePromise({ code, stdout, stderr });
		});
	});
}

/** The last line of output that is a JSON object; app logs on stdout are skipped. */
function lastJson(output: string): unknown {
	const start = output.indexOf('{\n  "formatVersion"');
	if (start >= 0) { try { return JSON.parse(output.slice(start)); } catch { /* fall through */ } }
	for (const item of output.split('\n').reverse()) {
		const parsed = parseLine(item);
		if (parsed) return parsed;
	}
	return null;
}

function parseLine(line: string): Record<string, unknown> & { type?: string } | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{')) return null;
	try { const value = JSON.parse(trimmed); return value && typeof value === 'object' ? value : null; } catch { return null; }
}

/** The end of a command's output, for an error message. */
function tail(text: string): string {
	return text.trim().split('\n').slice(-6).join('\n').slice(-1200);
}
