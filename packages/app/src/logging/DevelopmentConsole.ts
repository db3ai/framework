import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { PrettyLogFormatter } from './PrettyLogFormatter';
import type * as logging from './contracts';

/**
 * Owns grouped log output and a bounded live pending area in one terminal.
 * Multi-process launchers must pipe every child's output through this owner;
 * unrelated processes writing directly to the same TTY cannot be coordinated.
 */
export class DevelopmentConsole {
	readonly #output: NonNullable<logging.DevelopmentConsoleOptions['output']>;
	readonly #write: Writable['write'];
	readonly #formatter: PrettyLogFormatter;
	readonly #interactive: boolean;
	readonly #restore: Array<() => void> = [];
	#lines: string[] = [];
	#timer?: ReturnType<typeof setInterval>;
	#closed = false;

	/**
	 * Creates a console owner without starting an HTTP server or taking stream ownership.
	 * @param options - Destination, terminal capability and stdio coordination.
	 */
	constructor(options: logging.DevelopmentConsoleOptions = {}) {
		this.#output = options.output ?? process.stdout;
		this.#write = this.#output.write.bind(this.#output);
		this.#interactive = options.interactive ?? Boolean(this.#output.isTTY && process.env.TERM !== 'dumb');
		this.#formatter = new PrettyLogFormatter(options.color ?? consoleColor(Boolean(this.#output.isTTY), process.env));
		if (this.#interactive) {
			if (options.coordinateStdio !== false && this.#output === process.stdout) {
				this.#coordinate(process.stdout);
				this.#coordinate(process.stderr);
			}
			this.#timer = setInterval(() => {
				if (this.#lines.length && !this.#output.writableNeedDrain) this.#render('');
			}, 250);
			this.#timer.unref();
			const resize = (): void => { this.#render(''); };
			this.#output.on('resize', resize);
			this.#restore.push(() => { this.#output.off('resize', resize); });
		}
		const exit = (): void => { this.close(); };
		process.once('exit', exit);
		this.#restore.push(() => { process.off('exit', exit); });
	}

	/** Accepts a complete Pino JSON line, retaining ordinary non-log text verbatim. */
	write(line: string): void {
		if (this.#closed) return;
		try {
			const record = JSON.parse(line);
			if (record && typeof record === 'object' && typeof record.level === 'number') {
				this.#render(this.#formatter.format(record));
				return;
			}
		} catch { /* Non-JSON output from tools is ordinary terminal text. */ }
		this.writeText(line);
	}

	/** Writes tool output above pending rows, removing controls that clear terminal history. */
	writeText(text: string): void {
		if (this.#closed || !text) return;
		const safe = stripVTControlCharacters(text).replace(/\r/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
		this.#render(safe.endsWith('\n') ? safe : `${safe}\n`);
	}

	/**
	 * Creates a separately buffered child stdout/stderr sink, handling split UTF-8
	 * and final unterminated lines. Long non-JSON lines are forwarded in bounded chunks.
	 * @returns A writable input; end it when its child stream closes.
	 */
	createInput(): Writable {
		const decoder = new StringDecoder('utf8');
		let pending = '';
		const consume = (text: string): void => {
			pending += text;
			let newline: number;
			while ((newline = pending.indexOf('\n')) !== -1) {
				this.write(pending.slice(0, newline));
				pending = pending.slice(newline + 1);
			}
			if (pending.length > 256 * 1024) { this.writeText(pending); pending = ''; }
		};
		return new Writable({
			write: (chunk, _encoding, callback) => { consume(decoder.write(chunk)); callback(); },
			final: callback => { consume(decoder.end()); if (pending) this.write(pending); callback(); },
		});
	}

	/** Finalizes pending work from an exited child without disturbing other children. */
	endSource(pid: number): void { this.#render(this.#formatter.finish(pid)); }

	/** Waits for previously rendered output to reach the caller-owned destination. */
	async flush(): Promise<void> {
		await new Promise<void>((resolve, reject) => { this.#write('', error => error ? reject(error) : resolve()); });
	}

	/** Clears only owned rows, releases timers/listeners and restores patched stdio. */
	close(): void {
		if (this.#closed) return;
		clearInterval(this.#timer);
		this.#render(this.#formatter.finish());
		this.#closed = true;
		for (const restore of this.#restore.reverse()) restore();
	}

	/** Replaces only the live footer and appends immutable completed output above it. */
	#render(text: string): void {
		if (this.#closed) return;
		if (!this.#interactive) { if (text) this.#write(text); return; }
		const columns = Math.max(1, this.#output.columns ?? 80);
		const occupied = this.#lines.reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / columns)), 0);
		const clear = occupied ? `\u001b[${occupied}A\r\u001b[J` : '';
		const pending = this.#formatter.pending();
		const maximum = Math.max(1, Math.min(5, (this.#output.rows ?? 24) - 3));
		const visible = pending.slice(0, maximum);
		if (pending.length > maximum) visible[maximum - 1] = `[http] … ${pending.length - maximum + 1} more requests waiting`;
		// ASCII in mutable rows gives exact terminal-cell counts across resizes.
		this.#lines = columns < 20 ? [] : visible.map(line => line.replace(/→/g, '->').replace(/[^\x20-\x7e]/g, ' ').slice(0, columns - 1));
		const footer = this.#lines.length ? this.#lines.join('\n') + '\n' : '';
		if (clear || text || footer) this.#write(clear + text + footer);
	}

	/** Serializes same-process writes with redraws while preserving write callbacks. */
	#coordinate(stream: NodeJS.WriteStream): void {
		const original = stream.write;
		const write: typeof stream.write = (chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
			this.writeText(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8'));
			const done = typeof encoding === 'function' ? encoding : callback;
			return this.#write('', done);
		};
		stream.write = write;
		this.#restore.push(() => { if (stream.write === write) stream.write = original; });
	}
}

/**
 * Whether the pretty console uses colour. `NO_COLOR` turns it off; a set
 * `FORCE_COLOR` (other than `0` or `false`) turns it on even without a TTY, as
 * when a process manager pipes output into its own terminal view; otherwise a
 * TTY decides.
 *
 * @param isTTY - Whether the output stream is a terminal.
 * @param env - Process environment.
 * @returns Whether to emit ANSI colours.
 */
export function consoleColor(isTTY: boolean, env: NodeJS.ProcessEnv): boolean {
	if (env.NO_COLOR !== undefined) return false;
	const force = env.FORCE_COLOR;
	if (force === '0' || force === 'false') return false;
	return force !== undefined || isTTY;
}
