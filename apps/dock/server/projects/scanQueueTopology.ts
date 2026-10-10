import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { QueueTopology } from '../../shared/contracts.js';

const SOURCE_DIRS = ['server', 'apps', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', 'tests', '__tests__']);
const MAX_FILES = 3000;
const MAX_DEPTH = 8;

/**
 * Finds queue names and worker pools declared in a db3 app's source.
 *
 * db3 queue routing lives in code: jobs and queue config name a queue with
 * `queue: 'reports'`, and `runQueueConsole({ workers: { general: { queues } } })`
 * declares pools for `queue:work --pool`. This is a bounded static scan, so it
 * finds literal names only; `default` is always included.
 *
 * @param projectPath - Project folder.
 * @returns Sorted queue and pool names.
 */
export async function scanQueueTopology(projectPath: string): Promise<QueueTopology> {
	const queues = new Set<string>(['default']);
	const pools = new Set<string>();
	const files: string[] = [];
	for (const dir of SOURCE_DIRS) await collect(join(projectPath, dir), 0, files);
	for (const file of files) {
		let text: string;
		try {
			text = await readFile(file, 'utf8');
		} catch {
			continue;
		}
		for (const name of queueNamesIn(text)) queues.add(name);
		for (const name of poolNamesIn(text)) pools.add(name);
	}
	return { queues: [...queues].sort(byDefaultFirst), pools: [...pools].sort() };
}

/**
 * Literal queue names in a source file.
 *
 * @param text - Source text.
 * @returns Names from `queue: '…'` and `queues: ['…']`.
 */
export function queueNamesIn(text: string): string[] {
	const names: string[] = [];
	for (const match of text.matchAll(/\bqueue\s*:\s*['"`]([a-z0-9][\w.-]{0,63})['"`]/gi)) names.push(match[1]!);
	for (const match of text.matchAll(/\b(?:queues|excludeQueues)\s*:\s*\[([^\]]{0,500})\]/g)) {
		for (const item of match[1]!.matchAll(/['"`]([a-z0-9][\w.-]{0,63})['"`]/gi)) names.push(item[1]!);
	}
	return names;
}

/**
 * Worker pool names in a source file.
 *
 * @param text - Source text.
 * @returns Keys of objects shaped like `name: { queues: … }`.
 */
export function poolNamesIn(text: string): string[] {
	return [...text.matchAll(/\b([A-Za-z][\w-]{0,63})\s*:\s*\{\s*queues\s*:/g)].map(match => match[1]!);
}

async function collect(dir: string, depth: number, files: string[]): Promise<void> {
	if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (files.length >= MAX_FILES) return;
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await collect(join(dir, entry.name), depth + 1, files);
		} else if (/\.(ts|mts|js|mjs)$/.test(entry.name) && !/\.(test|spec|d)\.[mt]?[jt]s$/.test(entry.name)) {
			files.push(join(dir, entry.name));
		}
	}
}

function byDefaultFirst(a: string, b: string): number {
	if (a === 'default') return -1;
	if (b === 'default') return 1;
	return a.localeCompare(b);
}
