import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { GitBranch } from '../../shared/contracts.js';

/**
 * Reads the branch checked out in the git repository containing a folder.
 *
 * Reads `HEAD` directly instead of running `git`, so it is cheap enough to
 * call every few seconds for every project. Walks up from the folder, so a
 * project inside a monorepo reports the monorepo's branch, and follows the
 * `gitdir:` pointer that worktrees and submodules use.
 *
 * @param folder - Project folder, or any folder inside a repository.
 * @returns The branch, a short commit for a detached HEAD, or `null` when the folder is not in a git repository.
 */
export async function readGitBranch(folder: string): Promise<GitBranch | null> {
	const gitDir = await findGitDir(resolve(folder));
	if (!gitDir) return null;
	const head = await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null);
	return head === null ? null : parseHead(head);
}

/**
 * Interprets the contents of a `.git/HEAD` file.
 *
 * @param head - File contents, such as `ref: refs/heads/main` or a commit hash.
 * @returns The branch, or the short commit for a detached HEAD; `null` when unrecognised.
 */
export function parseHead(head: string): GitBranch | null {
	const text = head.trim();
	const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
	if (ref) return { name: ref[1]!, detached: false };
	if (/^[0-9a-f]{40,64}$/i.test(text)) return { name: text.slice(0, 7), detached: true };
	return null;
}

/** The git directory for a folder: the nearest `.git` folder, or the one a `.git` file points to. */
async function findGitDir(folder: string): Promise<string | null> {
	for (let current = folder; ; current = dirname(current)) {
		const candidate = join(current, '.git');
		const info = await stat(candidate).catch(() => null);
		if (info?.isDirectory()) return candidate;
		if (info?.isFile()) {
			const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(candidate, 'utf8').catch(() => ''));
			if (pointer) return isAbsolute(pointer[1]!.trim()) ? pointer[1]!.trim() : resolve(current, pointer[1]!.trim());
		}
		if (dirname(current) === current) return null;
	}
}
