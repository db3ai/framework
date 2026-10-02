/** Persistent transformation options supported by the installed Vitest runner. */
export interface VitestCacheOptions {
	/** Enables the disk-backed cache while retaining runtime isolation. */
	fsModuleCache: true;
	/** Workspace and dependency snapshot directory owned by this test runner. */
	fsModuleCachePath: string;
}

/**
 * Keeps transformation files separate across workspaces and dependency snapshots.
 *
 * @param workspaceUrl - Directory URL of the owning workspace.
 * @param lockfileUrl - Repository npm lockfile; missing files use an empty snapshot.
 * @returns Persistent cache options for Vitest 4.
 */
export function createVitestCacheOptions(workspaceUrl: URL, lockfileUrl: URL): VitestCacheOptions;
