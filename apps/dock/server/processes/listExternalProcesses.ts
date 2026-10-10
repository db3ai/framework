import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';

/** An `npm run <script>` job running on this machine, started by someone other than Dock. */
export interface ExternalProcess {
	/** Process id of the `npm run` leader; also its process group id. */
	pid: number;
	script: string;
	/** Working directory the script was started from. */
	cwd: string;
	/** Epoch milliseconds, estimated from elapsed time. */
	startedAt: number;
	/** TCP ports any process in the group listens on. */
	ports: number[];
}

/** One scan of the machine's processes. */
export interface ProcessScan {
	/** `npm run` jobs, including ones Dock started (the caller filters those). */
	jobs: ExternalProcess[];
	/** Listening TCP ports per process group id. */
	ports: Map<number, number[]>;
}

/**
 * Finds `npm run <script>` jobs and listening ports on macOS and Linux.
 *
 * Only process-group leaders are returned: a script run from a terminal leads its
 * own group, while nested `npm run` calls (inside `concurrently`, or one script
 * calling another) share their parent's group and are part of that job.
 * npm sets its process title to `npm run <script>` without the arguments, so
 * arguments are not available.
 *
 * @returns Running jobs with their folder and listening port, and ports per group.
 */
export async function scanProcesses(): Promise<ProcessScan> {
	if (process.platform === 'win32') return { jobs: [], ports: new Map() };
	const ps = await run('ps', ['-A', '-o', 'pid=,pgid=,etime=,command=']);
	if (!ps) return { jobs: [], ports: new Map() };
	const rows = parsePs(ps);
	const leaders = npmRunLeaders(rows);
	const [cwds, ports] = await Promise.all([
		leaders.length ? readCwds(leaders.map(row => row.pid)) : new Map<number, string>(),
		listeningPorts(rows),
	]);
	const now = Date.now();
	const jobs = leaders
		.filter(row => cwds.has(row.pid))
		.map(row => ({
			pid: row.pid,
			script: row.script,
			cwd: cwds.get(row.pid)!,
			startedAt: now - row.elapsedMs,
			ports: ports.get(row.pid) ?? [],
		}));
	return { jobs, ports };
}

/** One `ps` row. */
export interface PsRow {
	pid: number;
	pgid: number;
	elapsedMs: number;
	command: string;
}

/**
 * Parses `ps -o pid=,pgid=,etime=,command=` output.
 *
 * @param output - `ps` stdout.
 * @returns Rows.
 */
export function parsePs(output: string): PsRow[] {
	const rows: PsRow[] = [];
	for (const line of output.split('\n')) {
		const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*?)\s*$/.exec(line);
		if (!match) continue;
		rows.push({ pid: Number(match[1]), pgid: Number(match[2]), elapsedMs: parseElapsed(match[3]!), command: match[4]! });
	}
	return rows;
}

/**
 * Group leaders whose title is `npm run <script>`.
 *
 * @param rows - Parsed `ps` rows.
 * @returns Leaders with their script name.
 */
export function npmRunLeaders(rows: PsRow[]): Array<PsRow & { script: string }> {
	const leaders: Array<PsRow & { script: string }> = [];
	for (const row of rows) {
		if (row.pid !== row.pgid) continue;
		const match = /^npm run (\S+)(?:\s|$)/.exec(row.command) ?? /(?:^|\/)npm(?:-cli\.js)? run (\S+)(?:\s|$)/.exec(row.command);
		if (match) leaders.push({ ...row, script: match[1]! });
	}
	return leaders;
}

/**
 * Parses `ps` elapsed time: `ss`, `mm:ss`, `hh:mm:ss` or `d-hh:mm:ss`.
 *
 * @param text - Elapsed time.
 * @returns Milliseconds.
 */
export function parseElapsed(text: string): number {
	const [daysPart, clock] = text.includes('-') ? text.split('-') as [string, string] : ['0', text];
	const parts = clock.split(':').map(Number).reverse();
	const seconds = (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600 + Number(daysPart) * 86400;
	return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/**
 * Parses `lsof -F` output into pid → value for the `n` field.
 *
 * @param output - `lsof -Fpn` stdout.
 * @returns Values per pid, first one kept.
 */
export function parseLsofNames(output: string): Map<number, string[]> {
	const names = new Map<number, string[]>();
	let pid = 0;
	for (const line of output.split('\n')) {
		if (line.startsWith('p')) pid = Number(line.slice(1));
		else if (line.startsWith('n') && pid) names.set(pid, [...(names.get(pid) ?? []), line.slice(1)]);
	}
	return names;
}

async function readCwds(pids: number[]): Promise<Map<number, string>> {
	const cwds = new Map<number, string>();
	if (process.platform === 'linux') {
		await Promise.all(pids.map(async pid => {
			try {
				cwds.set(pid, await readlink(`/proc/${pid}/cwd`));
			} catch {
				// Gone, or not ours to read.
			}
		}));
		return cwds;
	}
	const output = await run('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]);
	for (const [pid, [cwd]] of parseLsofNames(output ?? '')) if (cwd) cwds.set(pid, cwd);
	return cwds;
}

/** Listening TCP ports per process group, keyed by group id. */
async function listeningPorts(rows: PsRow[]): Promise<Map<number, number[]>> {
	const output = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
	const groupOf = new Map(rows.map(row => [row.pid, row.pgid]));
	const ports = new Map<number, number[]>();
	for (const [pid, names] of parseLsofNames(output ?? '')) {
		const group = groupOf.get(pid);
		if (group === undefined) continue;
		const found = ports.get(group) ?? [];
		for (const name of names) {
			const port = Number(/:(\d+)$/.exec(name)?.[1]);
			if (port && !found.includes(port)) found.push(port);
		}
		ports.set(group, found);
	}
	return ports;
}

function run(command: string, args: string[]): Promise<string | null> {
	return new Promise(resolve => {
		execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
			// lsof exits 1 when some pids have gone; its output is still usable.
			resolve(stdout || (error ? null : ''));
		});
	});
}
