import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { HostDefinition } from '../../shared/hostContracts.js';

/** Folders Docker is commonly installed in; SSH sessions get a minimal `PATH` without them. */
const DOCKER_PATH = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/** An SSH destination: `host`, `user@host` or an `~/.ssh/config` alias. Never an option. */
const SSH_TARGET = /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/;

/** A container name or id as Docker allows them; safe to place in a shell command. */
export const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Runs shell scripts on a host: over SSH, or locally when the host has no `ssh`.
 *
 * SSH runs in batch mode, so it never prompts: keys must already work (as they
 * do for deployments). Connections are multiplexed through one master per host
 * so frequent samples don't pay for a new handshake each time.
 */
export class RemoteShell {
	readonly target: string;
	readonly #ssh: string | null;
	readonly #controlDir: string;

	/**
	 * @param host - Host definition.
	 * @param controlDir - Folder for SSH control sockets. Its path must stay short (Unix socket limit).
	 */
	constructor(host: Pick<HostDefinition, 'ssh'>, controlDir = join(homedir(), '.db3-dock', 'ssh')) {
		if (host.ssh && !SSH_TARGET.test(host.ssh)) throw new Error(`"${host.ssh}" is not an SSH destination.`);
		this.#ssh = host.ssh || null;
		this.#controlDir = controlDir;
		this.target = this.#ssh ? `ssh ${this.#ssh}` : 'this machine';
	}

	/**
	 * Runs a POSIX shell script and collects its output. The script travels on
	 * stdin, so nothing in it needs quoting for SSH.
	 *
	 * @param script - Script body.
	 * @param timeoutMs - Kill the command after this long.
	 * @returns Standard output.
	 * @throws When the command fails or times out, with its error output.
	 */
	run(script: string, timeoutMs = 20000): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = this.spawn(script);
			let stdout = '';
			let stderr = '';
			child.stdout!.on('data', chunk => (stdout += chunk));
			child.stderr!.on('data', chunk => (stderr += chunk));
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				reject(new Error(`${this.target} did not answer within ${Math.round(timeoutMs / 1000)}s.`));
			}, timeoutMs);
			child.on('error', error => {
				clearTimeout(timer);
				reject(error);
			});
			child.on('close', code => {
				clearTimeout(timer);
				if (code === 0) resolve(stdout);
				else reject(new Error(describeFailure(stderr, code, this.target)));
			});
		});
	}

	/**
	 * Starts a long-running script, such as `docker events` or `docker logs -f`.
	 * The caller owns the process and must kill it.
	 *
	 * @param script - Script body.
	 * @returns The child process, stdin already closed.
	 */
	spawn(script: string): ChildProcess {
		const child = this.#start();
		child.stdin!.end(`export PATH="${DOCKER_PATH}:$PATH"\n${script}\n`);
		return child;
	}

	/**
	 * Starts an endless command (`docker logs -f`, `docker events`) that ends
	 * when the returned stop function is called, on the remote host too.
	 *
	 * Killing a local `ssh` does not stop a remote command that is waiting for
	 * output. So the command runs in the background while the script reads stdin,
	 * which stays open: closing it ends the read, and the script kills the command.
	 * When the command ends by itself, it ends the script too.
	 *
	 * @param script - Command to run, in the remote shell's syntax.
	 * @returns The child process (stdout as UTF-8) and a stop function.
	 */
	stream(script: string): { child: ChildProcess; stop: () => void } {
		const child = this.#start();
		child.stdout!.setEncoding('utf8');
		// `kill 0` ends the shell's whole process group: the background command and
		// anything it started. The group is the SSH session's, or the local shell's own.
		child.stdin!.write(`export PATH="${DOCKER_PATH}:$PATH"\n(\n${script}\nkill $$ 2>/dev/null\n) </dev/null &\nwhile read -r _; do :; done\nkill 0 2>/dev/null\n`);
		let stopped = false;
		const stop = () => {
			if (stopped) return;
			stopped = true;
			child.stdin!.end();
			setTimeout(() => child.kill('SIGTERM'), 1500).unref();
		};
		return { child, stop };
	}

	#start(): ChildProcess {
		// Its own process group, so a stream's `kill 0` never reaches the Dock server.
		const options = { stdio: ['pipe', 'pipe', 'pipe'] as ('pipe')[], detached: true };
		const child = this.#ssh
			? spawn('ssh', [...this.#sshOptions(), this.#ssh, 'sh -s'], options)
			: spawn('sh', ['-s'], options);
		child.stdin!.on('error', () => undefined);
		return child;
	}

	#sshOptions(): string[] {
		try {
			mkdirSync(this.#controlDir, { recursive: true, mode: 0o700 });
		} catch {
			// Without a control folder SSH still works, just without multiplexing.
		}
		return [
			'-o', 'BatchMode=yes',
			'-o', 'ConnectTimeout=8',
			'-o', 'ServerAliveInterval=15',
			'-o', 'ControlMaster=auto',
			'-o', `ControlPath=${join(this.#controlDir, '%C')}`,
			'-o', 'ControlPersist=120',
			'-T',
		];
	}
}

function describeFailure(stderr: string, code: number | null, target: string): string {
	const text = stderr.trim().split('\n').filter(line => !/^Warning: Permanently added/.test(line)).join('\n').trim();
	if (code === 255 && /Permission denied|Host key verification|Could not resolve|Connection refused|timed out/i.test(text)) {
		return `Could not connect (${target}): ${text.split('\n').at(-1)}`;
	}
	return text || `${target} exited with code ${code}.`;
}
