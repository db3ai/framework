import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { runRepl } from '@db3.ai/app/cli';

/** Exercises the real Node evaluator, persistent await bindings, reset and normal cleanup. */
it('runs expressions with isolated globals and restores them after clear', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	let text = '';
	output.on('data', chunk => { text += chunk.toString(); });
	const session = runRepl({ input, output, values: { replTestValue: 40 } });
	try {
		input.write('const answer = await Promise.resolve(replTestValue + 2)\n');
		await vi.waitFor(() => expect(text.match(/db3> /g)).toHaveLength(2));
		input.write('answer\n');
		await vi.waitFor(() => expect(text).toContain('42'));
		input.write('throw new Error("recoverable expression")\n');
		await vi.waitFor(() => expect(text).toContain('recoverable expression'));
		input.write('.clear\nreplTestValue + 3\n');
		await vi.waitFor(() => expect(text).toContain('43'));
		expect(Object.hasOwn(globalThis, 'replTestValue')).toBe(false);
		input.write('.exit\n');
		await session;
		expect(input.listenerCount('error')).toBe(0);
	} finally {
		input.end();
		await session;
		output.end();
	}
});

/** Input failures must reject rather than leave the application awaiting an abandoned session. */
it('rejects stream failures and removes its error listeners', async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	const session = runRepl({ input, output, values: {} });
	const failure = expect(session).rejects.toThrow('input failed');
	input.emit('error', new Error('input failed'));
	await failure;
	expect(output.listenerCount('error')).toBe(0);
	input.end();
	output.end();
});

/** Checks the shipped executable, shared TypeScript module scope and real App.close(). */
it('boots the app and model registry once and closes the app after REPL exit', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'db3-repl-cli-'));
	try {
		await mkdir(join(directory, 'server/database'), { recursive: true });
		await writeFile(join(directory, 'package.json'), '{"type":"module"}');
		await writeFile(join(directory, 'server/database/models.ts'), 'export class Note {}\nexport const models = [Note];\n');
		const appModule = fileURLToPath(new URL('../../server/index.ts', import.meta.url));
		await writeFile(join(directory, 'server/cli.config.ts'), `import { App } from ${JSON.stringify(appModule)};
import { writeFile } from 'node:fs/promises';
import { Note } from './database/models';
class ReplApp extends App {
	model = Note;
	async close() { await super.close(); await writeFile(${JSON.stringify(join(directory, 'closed'))}, 'closed'); }
}
export default { commands: [], createApp: () => new ReplApp({ directory: ${JSON.stringify(directory)} }) };
`);
		const result = await executeRepl(directory, 'JSON.stringify({sameModel: app().model === Note, registry: models.Note === Note, result: await Promise.resolve(42)})');
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('"sameModel":true,"registry":true,"result":42');
		expect(await readFile(join(directory, 'closed'), 'utf8')).toBe('closed');
		await rm(join(directory, 'closed'));
		await writeFile(join(directory, 'server/database/models.ts'), 'export class Note {}\nexport const models = [Note, class Note {}];');
		const duplicate = await executeRepl(directory);
		expect(duplicate.status).toBe(1);
		expect(duplicate.stderr).toContain('Duplicate or reserved REPL model name: Note');
		expect(await readFile(join(directory, 'closed'), 'utf8')).toBe('closed');
		await rm(join(directory, 'server/cli.config.ts'));
		const missing = await executeRepl(directory);
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain('requires createApp');
	} finally { await rm(directory, { recursive: true, force: true }); }
}, 30_000);

/**
 * Drives a real REPL subprocess, waiting for awaited evaluation before exiting.
 *
 * @param directory - Temporary app directory containing its CLI configuration.
 * @param expression - Optional expression to execute once the prompt appears.
 * @returns Captured process status and terminal streams.
 */
function executeRepl(directory: string, expression?: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [fileURLToPath(new URL('../../../bin/db3.mjs', import.meta.url)), 'repl'], { cwd: directory, env: { ...process.env, DATABASE_URL: '', OPENAI_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let sent = false;
		const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`REPL timed out: ${stdout}\n${stderr}`)); }, 15_000);
		child.stdout.on('data', chunk => {
			stdout += chunk.toString();
			if (!sent && stdout.includes('db3> ')) {
				sent = true;
				child.stdin.write(expression ? `${expression}\n` : '.exit\n');
			} else if (sent && (stdout.match(/db3> /g)?.length ?? 0) >= 2) child.stdin.end('.exit\n');
		});
		child.stderr.on('data', chunk => { stderr += chunk.toString(); });
		child.once('error', error => { clearTimeout(timeout); reject(error); });
		child.once('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
	});
}
