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
	/** The service inside an app the import reaches into, for a problem between services of one app. */
	service?: string;
	message: string;
}

/** What `db3 apps:check` found: the apps it read and every boundary problem. */
export interface AppBoundaryReport {
	apps: { id: string; contract: string | null; requires: string[]; services: string[] }[];
	problems: AppBoundaryProblem[];
}

/**
 * Checks that each local app reaches other apps only through their contracts.
 *
 * An app may import another app's `contract` file (named in that app's manifest) and nothing else
 * from it, and only when that app is in its `requires` or `optional`. A declared contract file must
 * exist.
 *
 * Inside an app, each folder under `services/` is a service: a lower-level piece with its own
 * `contract.ts`. Code outside a service may import only that contract. The app's entry file, which
 * builds the services, and files under a `tests` folder may import a service's other files.
 *
 * Reads files only; never loads app code. Apps installed from npm are read for their contracts but
 * their own code is not checked.
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
		const services = appServices(app.directory);
		for (const service of services) {
			if (!existsSync(join(service.directory, 'contract.ts'))) problems.push({ app: app.manifest.id, file: show(service.directory), line: 0, service: service.id, message: `Service "${service.id}" has no contract.ts.` });
		}
		for (const file of sourceFiles(app.directory)) {
			const text = withoutComments(readFileSync(file, 'utf8'));
			const privileged = file === app.entry || relative(app.directory, file).split(sep).includes('tests');
			for (const match of text.matchAll(IMPORT)) {
				const specifier = match[1] ?? match[2]!;
				if (!specifier.startsWith('.')) continue;
				const target = resolve(dirname(file), specifier);
				const service = services.find(item => inside(item.directory, target) && !inside(item.directory, file));
				if (service && !privileged && !names(target, join(service.directory, 'contract.ts'))) {
					problems.push({ app: app.manifest.id, file: show(file), line: text.slice(0, match.index).split('\n').length, service: service.id, message: `Imports ${show(target)}; only service "${service.id}"'s contract ${show(join(service.directory, 'contract.ts'))} may be imported.` });
					continue;
				}
				const owner = local.find(other => other !== app && inside(other.directory, target));
				if (!owner) continue;
				const id = owner.manifest.id;
				const line = text.slice(0, match.index).split('\n').length;
				const at = { app: app.manifest.id, file: show(file), line, target: id };
				if (!owner.contract) problems.push({ ...at, message: `Imports ${show(target)} from "${id}", which has no contract. Give "${id}" a contract file in its manifest and import that.` });
				else if (!names(target, owner.contract)) problems.push({ ...at, message: `Imports ${show(target)}; only "${id}"'s contract ${show(owner.contract)} may be imported.` });
				else if (!allowed.has(id)) problems.push({ ...at, message: `Imports "${id}"'s contract without declaring it: add "${id}" to requires or optional in its manifest.` });
			}
		}
	}
	return { apps: apps.map(app => ({ id: app.manifest.id, contract: app.contract ? show(app.contract) : null, requires: Object.keys({ ...app.manifest.requires, ...app.manifest.optional }), services: app.packageName ? [] : appServices(app.directory).map(service => service.id) })), problems };
}

/**
 * Formats a report for the terminal: one line per problem, or a one-line all-clear.
 * @param report - Result of checkAppBoundaries.
 */
export function formatAppBoundaries(report: AppBoundaryReport): string {
	if (!report.problems.length) { const services = report.apps.reduce((sum, app) => sum + app.services.length, 0); return `App boundaries hold: ${report.apps.length} apps, ${report.apps.filter(app => app.contract).length} with contracts${services ? `, ${services} service${services === 1 ? '' : 's'}` : ''}.`; }
	return [...report.problems.map(problem => `${problem.file}${problem.line ? `:${problem.line}` : ''}  ${problem.app}: ${problem.message}`), `${report.problems.length} app boundary problem${report.problems.length === 1 ? '' : 's'}.`].join('\n');
}

/**
 * The services inside an app: each folder under its `services/`.
 * @param directory - The app's folder.
 */
export function appServices(directory: string): { id: string; directory: string }[] {
	const root = join(directory, 'services');
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => ({ id: item.name, directory: join(root, item.name) })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every relative import under a folder, as the importing file and the absolute path it names (extension as written).
 * @param directory - Folder to read.
 */
export function relativeImports(directory: string): { file: string; target: string }[] {
	const found: { file: string; target: string }[] = [];
	for (const file of sourceFiles(directory)) {
		for (const match of withoutComments(readFileSync(file, 'utf8')).matchAll(IMPORT)) {
			const specifier = match[1] ?? match[2]!;
			if (specifier.startsWith('.')) found.push({ file, target: resolve(dirname(file), specifier) });
		}
	}
	return found;
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

/**
 * Whether an import names a module file: the file as written, or without an extension, or with
 * `.js` standing for its TypeScript source. `./contract.vue` does not name `contract.ts`.
 */
function names(target: string, file: string) {
	if (target === file) return true;
	const extension = extname(target);
	return (extension === '' ? target : extension === '.js' ? stem(target) : null) === stem(file);
}

/** Source text with comments blanked, keeping every line and offset, so a commented-out import is not read as one. */
function withoutComments(text: string) {
	return text.replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<![:'"`\\])\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
}

/** A module path without its extension, so `./contract.js` names `contract.ts`. */
function stem(path: string) {
	return path.slice(0, path.length - extname(path).length);
}

