import { lstat, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** Reviewed app roots shared by source export, creator packaging and generation. */
export const STARTER_SOURCE_ENTRIES = new Set([
	'.env.example', '.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'docker-compose.yml',
	'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts',
	'apps', 'client', 'scripts', 'server', 'tests',
]);

const artifacts = new Set(['node_modules', 'dist', 'coverage', '.git', '.cache', '.db3', '.vite', '.turbo', '.playwright-cli', 'output', 'playwright-report', 'test-results', '.DS_Store', '.npmrc', 'package-lock.json']);
const extensions = new Set(['.ts', '.mjs', '.json', '.vue', '.css', '.html', '.svg', '.md', '.yml', '.yaml']);

/**
 * Lists portable application files without inheriting local secrets or artifacts.
 *
 * All three consumers use this selection so running the workspace cannot change
 * what is shipped. Symlinks and unreviewed files fail rather than copying data
 * from outside the app or silently omitting a new source requirement.
 *
 * @param {string} root - Canonical starter or packaged template directory.
 * @returns {Promise<string[]>} Sorted POSIX paths relative to the app root.
 */
export async function listStarterFiles(root) {
	const stats = await lstat(root);
	if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Starter source must be a real directory.');
	const files = [];
	await visit('');
	return files;

	/**
	 * Traverses one reviewed directory, rejecting links before any file is copied.
	 * @param {string} directory - App-relative POSIX directory, empty for the root.
	 * @returns {Promise<void>} Resolves after collecting this directory's files.
	 */
	async function visit(directory) {
		const entries = await readdir(join(root, directory), { withFileTypes: true });
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const path = directory ? `${directory}/${entry.name}` : entry.name;
			// The optional desktop experiment is not part of generated web applications.
			if (path === 'storage' || path === 'electron' || artifacts.has(entry.name) || (entry.name.startsWith('.env') && path !== '.env.example') || /\.(?:log|tsbuildinfo)$/.test(entry.name)) continue;
			if (!STARTER_SOURCE_ENTRIES.has(path.split('/')[0])) throw new Error(`Starter source path "${path}" is outside the reviewed app roots.`);
			if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in starter source: "${path}".`);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile() && (path === '.env.example' || path === '.gitignore' || extensions.has(extname(path)))) files.push(path);
			else throw new Error(`Unsupported starter source file: "${path}".`);
		}
	}
}
