import * as pty from 'node-pty';

import type { OutputChunk, ProcessDefinition, ProcessSnapshot, ProcessStatus } from '../../shared/contracts.js';
import { detectPort } from '../../shared/detectPort.js';
import { displayCommand } from '../../shared/workerArgs.js';
import { ScrollbackBuffer } from './ScrollbackBuffer.js';

/** Callbacks a supervised process reports through. */
export interface SupervisedProcessEvents {
	change(snapshot: ProcessSnapshot): void;
	output(processId: string, chunks: OutputChunk[]): void;
}

/** Options for spawning, overridable in tests. */
export interface SupervisedProcessOptions {
	/** Executable used to run scripts. */
	npm?: string;
	/** Milliseconds between SIGTERM and SIGKILL when stopping. */
	killAfterMs?: number;
	/** Scrollback characters kept per process. */
	scrollback?: number;
	/** Extra environment for every child. */
	env?: NodeJS.ProcessEnv;
}

/** Terminal size used until a pane reports its own. */
const DEFAULT_SIZE = { cols: 120, rows: 30 };

/** Dim italic, the way Dock marks its own notes in a terminal. */
function note(text: string): string {
	return `\u001b[2;3m${text}\u001b[0m\r\n`;
}

/**
 * Runs one `npm run <script>` in its project folder inside a pseudo-terminal,
 * as VS Code's integrated terminal does, and tracks its lifecycle.
 *
 * The script sees a real terminal (`xterm-256color`), so it colours its output,
 * draws progress and reads keystrokes as it would in iTerm or Cursor. The PTY
 * child leads its own session and process group, so stopping it also stops
 * npm and the script's own children (Vite, tsx watchers and so on).
 */
export class SupervisedProcess {
	readonly output: ScrollbackBuffer;
	private term: pty.IPty | null = null;
	private size = { ...DEFAULT_SIZE };
	private status: ProcessStatus = 'stopped';
	private startedAt: number | null = null;
	private exitCode: number | null = null;
	private port: number | null = null;
	/** Whether `port` came from the process's own output. */
	private portAnnounced = false;
	private listening: number[] = [];
	/** Unterminated output text, kept to find announced ports across chunks. */
	private pendingLine = '';
	private stopRequested = false;
	private restartRequested = false;
	private killTimer: NodeJS.Timeout | null = null;
	private exitWaiters: Array<() => void> = [];
	private stats: { cpu: number | null; memory: number | null } = { cpu: null, memory: null };
	/** A job started outside Dock that this definition is showing. */
	private external: { pid: number } | null = null;
	private externalPoll: NodeJS.Timeout | null = null;

	constructor(
		readonly projectId: string,
		private definition: ProcessDefinition,
		private readonly cwd: string,
		private readonly events: SupervisedProcessEvents,
		private readonly options: SupervisedProcessOptions = {},
	) {
		this.output = new ScrollbackBuffer(options.scrollback);
	}

	get id(): string {
		return this.definition.id;
	}

	get pid(): number | null {
		return this.term?.pid ?? this.external?.pid ?? null;
	}

	/** Process id of a child Dock spawned itself, if running. */
	get ownedPid(): number | null {
		return this.term?.pid ?? null;
	}

	/** Process id of the attached outside job, if any. */
	get externalPid(): number | null {
		return this.external?.pid ?? null;
	}

	/** Whether Dock can attach an outside job: nothing is running or shutting down. */
	get isIdle(): boolean {
		return !this.term && !this.external && this.status !== 'stopping';
	}

	get isRunning(): boolean {
		return this.status === 'running' || this.status === 'stopping';
	}

	/** Current state for the client. */
	snapshot(): ProcessSnapshot {
		return {
			id: this.definition.id,
			projectId: this.projectId,
			status: this.status,
			pid: this.isRunning ? this.pid : null,
			startedAt: this.isRunning ? this.startedAt : null,
			exitCode: this.exitCode,
			port: this.isRunning ? this.port : null,
			ports: this.isRunning ? this.listening : [],
			cpu: this.isRunning ? this.stats.cpu : null,
			memory: this.isRunning ? this.stats.memory : null,
			command: displayCommand(this.definition.script, this.definition.args),
			external: !!this.external,
		};
	}

	/** Starts the script unless it is already running. */
	start(): void {
		if (this.term || this.external) return;
		const { script, args } = this.definition;
		this.stopRequested = false;
		this.exitCode = null;
		this.port = null;
		this.portAnnounced = false;
		this.listening = [];
		this.pendingLine = '';
		this.stats = { cpu: null, memory: null };
		this.note(`$ ${displayCommand(script, args)}`);
		let term: pty.IPty;
		try {
			term = pty.spawn(this.options.npm ?? 'npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {
				name: 'xterm-256color',
				cols: this.size.cols,
				rows: this.size.rows,
				cwd: this.cwd,
				env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'db3-dock', ...this.options.env } as Record<string, string>,
			});
		} catch (error) {
			this.note(`Failed to start: ${(error as Error).message}`);
			this.exitCode = null;
			this.setStatus('crashed');
			return;
		}
		this.term = term;
		this.startedAt = Date.now();
		this.setStatus('running');
		term.onData(data => this.receive(data));
		term.onExit(({ exitCode, signal }) => this.exited(term, exitCode, signal));
	}

	/**
	 * Stops the process group: SIGTERM, then SIGKILL after a grace period.
	 *
	 * @returns Resolves once the process has exited.
	 */
	stop(): Promise<void> {
		if (!this.term && !this.external) return Promise.resolve();
		const done = new Promise<void>(resolve => this.exitWaiters.push(resolve));
		if (this.stopRequested) return done;
		this.stopRequested = true;
		this.setStatus('stopping');
		this.signal('SIGTERM');
		this.killTimer = setTimeout(() => this.signal('SIGKILL'), this.options.killAfterMs ?? 8000);
		// An outside job is not our child, so poll for its exit.
		if (this.external) this.externalPoll = setInterval(() => {
			if (this.external && !isAlive(this.external.pid)) this.externalEnded();
		}, 150);
		return done;
	}

	/**
	 * Shows a job that was started outside Dock as this process.
	 *
	 * @param job - The job's pid, start time and listening port.
	 * @returns Whether it was attached (only when nothing else is running here).
	 */
	attach(job: { pid: number; startedAt: number; port: number | null; ports: number[] }): boolean {
		if (!this.isIdle) return false;
		this.external = { pid: job.pid };
		this.startedAt = job.startedAt;
		this.port = job.port;
		this.portAnnounced = false;
		this.listening = job.ports;
		this.exitCode = null;
		this.stats = { cpu: null, memory: null };
		this.note(`Found running outside Dock (pid ${job.pid}), started from a terminal or editor.`);
		this.note('Its output goes to that terminal, so it cannot be shown here. Restart it to run it inside Dock.');
		this.setStatus('running');
		return true;
	}

	/**
	 * Records the ports the process group listens on, from a scan. The main port
	 * follows the scan unless the process announced one in its output.
	 *
	 * @param ports - Every listening port.
	 * @param main - The port chosen as main among them.
	 */
	setListening(ports: number[], main: number | null): void {
		if (!this.isRunning) return;
		const port = this.portAnnounced ? this.port : main;
		if (port === this.port && ports.join() === this.listening.join()) return;
		this.port = port;
		this.listening = ports;
		this.events.change(this.snapshot());
	}

	/** Records that the attached outside job has ended. */
	externalEnded(): void {
		if (!this.external) return;
		if (this.externalPoll) clearInterval(this.externalPoll);
		if (this.killTimer) clearTimeout(this.killTimer);
		this.externalPoll = null;
		this.killTimer = null;
		this.external = null;
		const requested = this.stopRequested;
		this.note(requested ? (this.restartRequested ? 'Restarting inside Dock…' : 'Stopped.') : 'Ended outside Dock.');
		this.setStatus('stopped');
		this.stopRequested = false;
		for (const resolve of this.exitWaiters.splice(0)) resolve();
	}

	/** Stops the process if running, then starts it again. */
	async restart(): Promise<void> {
		this.restartRequested = true;
		await this.stop();
		this.restartRequested = false;
		this.start();
	}

	/**
	 * Sends keystrokes to the terminal, exactly as typed (Enter is `\r`).
	 *
	 * @param data - Raw input from the terminal emulator.
	 */
	write(data: string): void {
		if (!this.term || this.stopRequested) return;
		try {
			this.term.write(data);
		} catch {
			// The process exited between the keystroke and the write.
		}
	}

	/**
	 * Sets the terminal size, as a pane reports it. Kept for the next start.
	 *
	 * @param cols - Columns, 2–1000.
	 * @param rows - Rows, 1–1000.
	 */
	resize(cols: number, rows: number): void {
		const next = { cols: clampInt(cols, 2, 1000), rows: clampInt(rows, 1, 1000) };
		if (next.cols === this.size.cols && next.rows === this.size.rows) return;
		this.size = next;
		try {
			this.term?.resize(next.cols, next.rows);
		} catch {
			// The process exited; the size applies to the next start.
		}
	}

	/** Clears scrollback. */
	clearOutput(): void {
		this.output.clear();
	}

	/**
	 * Replaces the definition, for example after a rename. Takes effect on next start.
	 *
	 * @param definition - New definition with the same id.
	 */
	update(definition: ProcessDefinition): void {
		this.definition = definition;
	}

	/**
	 * Records sampled resource use.
	 *
	 * @param cpu - CPU percentage.
	 * @param memory - Resident bytes.
	 */
	setStats(cpu: number | null, memory: number | null): void {
		if (!this.isRunning) return;
		if (cpu === this.stats.cpu && memory === this.stats.memory) return;
		this.stats = { cpu, memory };
		this.events.change(this.snapshot());
	}

	private receive(data: string): void {
		this.emit(data);
		if (this.port !== null) return;
		const lines = (this.pendingLine + data).split('\n');
		this.pendingLine = lines.pop()!.slice(-4096);
		for (const line of lines) {
			const port = detectPort(line);
			if (port !== null) {
				this.port = port;
				this.portAnnounced = true;
				this.events.change(this.snapshot());
				return;
			}
		}
	}

	private exited(term: pty.IPty, code: number, signal: number | undefined): void {
		if (this.term !== term) return;
		if (this.killTimer) clearTimeout(this.killTimer);
		this.killTimer = null;
		this.term = null;
		const requested = this.stopRequested;
		// Ctrl-C in the terminal ends a script with SIGINT, or npm with code 130: a stop, not a crash.
		const interrupted = signal === 2 || code === 130;
		this.exitCode = signal ? null : code;
		this.note(requested
			? (this.restartRequested ? 'Restarting…' : 'Stopped.')
			: interrupted ? 'Interrupted.' : signal ? `Exited with signal ${signal}.` : `Exited with code ${code}.`);
		this.setStatus(requested || interrupted || (code === 0 && !signal) ? 'stopped' : 'crashed');
		this.stopRequested = false;
		for (const resolve of this.exitWaiters.splice(0)) resolve();
	}

	private signal(signal: NodeJS.Signals): void {
		const pid = this.term?.pid ?? this.external?.pid;
		if (!pid) return;
		try {
			process.kill(-pid, signal);
		} catch {
			try {
				process.kill(pid, signal);
			} catch {
				// Already gone.
			}
		}
	}

	/** Writes a Dock note into the terminal, on a line of its own. */
	private note(text: string): void {
		this.emit(`${this.output.atLineStart ? '' : '\r\n'}${note(text)}`);
	}

	private emit(data: string): void {
		this.events.output(this.definition.id, [this.output.append(data)]);
	}

	private setStatus(status: ProcessStatus): void {
		this.status = status;
		this.events.change(this.snapshot());
	}
}

function clampInt(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(Number(value) || min)));
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}
