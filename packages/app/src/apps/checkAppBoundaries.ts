import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { discoverApps } from './discoverApps';

/** Source files whose imports are read. */
const SOURCE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.vue']);
/** Folders never read: installed or built code. */
const SKIPPED = new Set(['node_modules', 'dist', '.db3', '.git']);
/** `import … from 'x'`, `export … from 'x'`, `import 'x'` and `import('x')`, across lines. */
const IMPORT = /(?:\bimport|\bexport)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/** One place where an app reaches past another app's contract. */
export interface AppBoundaryProblem {
	/** App whose code crosses the boundary, or whose manifest is wrong. */
	app: string;
	/** File holding the import, relative to the project, or the manifest. */
	file: string;
	/** Line of the import, from 1; 0 for a manifest problem. */
	line: number;
	/** The app the import reaches into, when there is one. */
	target?: string;
	message: string;
}

/** What `db3 apps:check` found: the apps it read and every boundary problem. */
export interface AppBoundaryReport {
	apps: { id: string; contract: string | null; requires: string[] }[];
	problems: AppBoundaryProblem[];
}

/**
 * Checks that each local app reaches other apps only through their contracts.
 *
 * An app may import another app's `contract` file (named in that app's manifest) and nothing else
 * from it, and only when that app is in its `requires` or `optional`. A declared contract file must
 * exist. Reads files only; never loads app code. Apps installed from npm are read for their
 * contracts but their own code is not checked.
 * @param directory - Project root holding `apps/`.
 * @returns Every app read and every problem, in file order.
 */
export function checkAppBoundaries(directory: string): AppBoundaryReport {
	const root = resolve(directory);
	const apps = discoverApps(root);
	const local = apps.filter(app => !app.packageName);
	const problems: AppBoundaryProblem[] = [];
	const show = (file: string) => relative(root, file).split(sep).join('/');
	for (const app of local) {
		if (app.contract && !existsSync(app.contract)) problems.push({ app: app.manifest.id, file: show(join(app.directory, 'manifest.json')), line: 0, message: `Its contract file ${show(app.contract)} does not exist.` });
	}
	for (const app of local) {
		const allowed = new Set(Object.keys({ ...app.manifest.requires, ...app.manifest.optional }));
		for (const file of sourceFiles(app.directory)) {
			const text = readFileSync(file, 'utf8');
			for (const match of text.matchAll(IMPORT)) {
				const specifier = match[1] ?? match[2]!;
				if (!specifier.startsWith('.')) continue;
				const target = resolve(dirname(file), specifier);
				const owner = local.find(other => other !== app && inside(other.directory, target));
				if (!owner) continue;
				const id = owner.manifest.id;
				const line = text.slice(0, match.index).split('\n').length;
				const at = { app: app.manifest.id, file: show(file), line, target: id };
				if (!owner.contract) problems.push({ ...at, message: `Imports ${show(target)} from "${id}", which has no contract. Give "${id}" a contract file in its manifest and import that.` });
				else if (stem(target) !== stem(owner.contract)) problems.push({ ...at, message: `Imports ${show(target)}; only "${id}"'s contract ${show(owner.contract)} may be imported.` });
				else if (!allowed.has(id)) problems.push({ ...at, message: `Imports "${id}"'s contract without declaring it: add "${id}" to requires or optional in its manifest.` });
			}
		}
	}
	return { apps: apps.map(app => ({ id: app.manifest.id, contract: app.contract ? show(app.contract) : null, requires: Object.keys({ ...app.manifest.requires, ...app.manifest.optional }) })), problems };
}

/**
 * Formats a report for the terminal: one line per problem, or a one-line all-clear.
 * @param report - Result of checkAppBoundaries.
 */
export function formatAppBoundaries(report: AppBoundaryReport): string {
	if (!report.problems.length) return `App boundaries hold: ${report.apps.length} apps, ${report.apps.filter(app => app.contract).length} with contracts.`;
	return [...report.problems.map(problem => `${problem.file}${problem.line ? `:${problem.line}` : ''}  ${problem.app}: ${problem.message}`), `${report.problems.length} app boundary problem${report.problems.length === 1 ? '' : 's'}.`].join('\n');
}

/** Every source file under a folder, skipping installed and built code. */
function* sourceFiles(directory: string): Generator<string> {
	for (const item of readdirSync(directory, { withFileTypes: true })) {
		if (SKIPPED.has(item.name)) continue;
		const path = join(directory, item.name);
		if (item.isDirectory()) yield* sourceFiles(path);
		else if (item.isFile() && SOURCE.has(extname(item.name)) && !item.name.endsWith('.d.ts')) yield path;
	}
}

/** Whether a path is a folder or inside it. */
function inside(directory: string, path: string) {
	return path === directory || path.startsWith(directory + sep);
}

/** A module path without its extension, so `./contract.js` names `contract.ts`. */
function stem(path: string) {
	return path.slice(0, path.length - extname(path).length);
}

