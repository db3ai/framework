/**
 * Reuses Node's compiled dependencies between isolated test workers and runs.
 *
 * This caches bytecode rather than application state. Coverage runs disable the
 * cache because V8 needs fresh source positions for accurate coverage results.
 * Explicit cache locations and opt-outs remain authoritative for ordinary runs.
 *
 * @param {string[]} testArguments - Arguments forwarded to the workspace test runner.
 * @param {{environment?: Record<string, string | undefined>, cacheDirectory: string}} options - Parent environment and repository-owned cache location.
 * @returns {Record<string, string | undefined>} Independent environment for the test subprocess.
 */
export function createTestEnvironment(testArguments, { environment = process.env, cacheDirectory }) {
	const env = { ...environment };
	const coverage = testArguments.some(argument => /^--coverage(?:[.=]|$)/.test(argument));
	if (coverage) {
		delete env.NODE_COMPILE_CACHE;
		env.NODE_DISABLE_COMPILE_CACHE = '1';
	} else {
		env.NODE_COMPILE_CACHE ??= cacheDirectory;
	}
	return env;
}
