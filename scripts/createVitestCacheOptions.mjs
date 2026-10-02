import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Keeps Vitest's transformation cache private to a workspace and lockfile version.
 *
 * Vitest clears its cache when dependency metadata changes. Distinct directories
 * prevent a newly started run from deleting files an older run is still reading.
 * Source and configuration changes retain Vitest's own per-module invalidation.
 *
 * @param {URL} workspaceUrl - Directory URL of the owning workspace.
 * @param {URL} lockfileUrl - Repository npm lockfile; exports without one use an empty snapshot.
 * @returns {{fsModuleCache: true, fsModuleCachePath: string}} Installed Vitest 4 cache options.
 */
export function createVitestCacheOptions(workspaceUrl, lockfileUrl) {
	const lockfile = existsSync(lockfileUrl) ? readFileSync(lockfileUrl) : '';
	const version = createHash('sha256').update(lockfile).digest('hex').slice(0, 16);
	return { fsModuleCache: true, fsModuleCachePath: fileURLToPath(new URL(`./node_modules/.cache/vitest-transforms/${version}/`, workspaceUrl)) };
}
