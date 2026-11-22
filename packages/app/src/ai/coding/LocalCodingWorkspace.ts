import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CodingCommandResult, CodingWorkspace } from './CodingWorkspace';

/**
 * Runs a coding agent directly in a folder on this machine.
 *
 * Commands run as the current user with no sandbox, so use it only for trusted
 * work such as tests, examples or a developer's own machine. Hosted products
 * give agents a workspace inside an isolated container instead.
 */
export class LocalCodingWorkspace implements CodingWorkspace {
	/**
	 * @param root - Absolute folder the agent works in.
	 * @param maxOutputBytes - Bytes kept from each output stream.
	 */
	constructor(readonly root: string, private readonly maxOutputBytes = 1_000_000) {}

	/** Runs the command with `bash -lc` and kills its process group at the time limit. */
	run(command: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<CodingCommandResult> {
		return new Promise((resolve, reject) => {
			const child = spawn('bash', ['-lc', command], { cwd: this.root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			let kept = { stdout: 0, stderr: 0 };
			let timedOut = false;
			/** Ends the whole process group so background children stop too. */
			const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already exited */ } };
			const timer = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
			options.signal?.addEventListener('abort', kill, { once: true });
			/** Keeps output up to the byte limit. */
			const collect = (stream: 'stdout' | 'stderr', target: Buffer[]) => (chunk: Buffer) => {
				const room = this.maxOutputBytes - kept[stream];
				if (room <= 0) return;
				target.push(chunk.subarray(0, room));
				kept = { ...kept, [stream]: kept[stream] + Math.min(room, chunk.length) };
			};
			child.stdout.on('data', collect('stdout', stdout));
			child.stderr.on('data', collect('stderr', stderr));
			child.once('error', error => { clearTimeout(timer); reject(error); });
			child.once('close', code => {
				clearTimeout(timer);
				options.signal?.removeEventListener('abort', kill);
				resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: timedOut ? null : code, timedOut });
			});
		});
	}

	/** Reads a file, returning null when it does not exist. */
	async readFile(path: string): Promise<string | null> {
		try { return await readFile(join(this.root, path), 'utf8'); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
	}

	/** Writes a file, creating its parent folders. */
	async writeFile(path: string, content: string): Promise<void> {
		const target = join(this.root, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}

	/** Deletes a file. */
	async deleteFile(path: string): Promise<void> { await rm(join(this.root, path)); }
}
