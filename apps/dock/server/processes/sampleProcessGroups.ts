import { execFile } from 'node:child_process';

/** Resource use summed over one process group. */
export interface GroupUsage {
	/** CPU percentage as reported by `ps` (can exceed 100 on several cores). */
	cpu: number;
	/** Resident memory in bytes. */
	memory: number;
}

/**
 * Samples CPU and memory for process groups using `ps` (macOS and Linux).
 *
 * @param groupIds - Process group ids to report.
 * @returns Usage keyed by group id; groups with no live processes are absent.
 */
export function sampleProcessGroups(groupIds: number[]): Promise<Map<number, GroupUsage>> {
	const wanted = new Set(groupIds);
	return new Promise(resolve => {
		if (!wanted.size || process.platform === 'win32') {
			resolve(new Map());
			return;
		}
		execFile('ps', ['-A', '-o', 'pgid=,pcpu=,rss='], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolve(error ? new Map() : parsePsGroups(stdout, wanted));
		});
	});
}

/**
 * Sums `ps -o pgid=,pcpu=,rss=` rows by group.
 *
 * @param output - `ps` stdout.
 * @param wanted - Groups to keep.
 * @returns Usage per wanted group.
 */
export function parsePsGroups(output: string, wanted: Set<number>): Map<number, GroupUsage> {
	const usage = new Map<number, GroupUsage>();
	for (const row of output.split('\n')) {
		const [pgid, cpu, rss] = row.trim().split(/\s+/).map(Number);
		if (pgid === undefined || !wanted.has(pgid)) continue;
		const current = usage.get(pgid) ?? { cpu: 0, memory: 0 };
		current.cpu += Number.isFinite(cpu) ? cpu! : 0;
		current.memory += Number.isFinite(rss) ? rss! * 1024 : 0;
		usage.set(pgid, current);
	}
	for (const value of usage.values()) value.cpu = Math.round(value.cpu * 10) / 10;
	return usage;
}
