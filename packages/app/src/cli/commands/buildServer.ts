import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
import { COMPILED_APPS } from '../../apps/compiledApps';
import { discoverApps } from '../../apps/discoverApps';
import type { CliCommand } from '../contracts';

/** Where `db3 build:server` writes by default, relative to the app root. */
export const SERVER_BUILD_DIRECTORY = 'dist-server';

/** What one server build wrote. */
export interface ServerBuild {
	/** Absolute paths of the entry files written, one per entry, as `<outdir>/<entry name>.mjs`. */
	outputs: string[];
	/** Absolute source paths of the app entries compiled into the build. */
	apps: string[];
}

/** Settings for one server build. */
export interface BuildServerOptions {
	/** App root: the folder with package.json and `apps/`. */
	directory: string;
	/** Server entry files relative to the root, such as `server/index.ts`. */
	entries: readonly string[];
	/** Output folder relative to the root. */
	outdir?: string;
}

const TYPESCRIPT = /\.[cm]?tsx?$/;
const SOURCE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const META = /\bimport\.meta\.(url|dirname|filename)\b/g;
const loaders = { '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx' } as const;
const insideDependencies = (path: string) => path.split(sep).includes('node_modules');
/** Installed JavaScript loads from node_modules as it is; TypeScript, wherever it lives, needs compiling. */
const external = (path: string) => insideDependencies(path) && !TYPESCRIPT.test(path);

/**
 * Compiles server entry files and the app's TypeScript sub apps into plain JavaScript that
 * `node` runs with no TypeScript loader, so a process starts in a fraction of the time `tsx` takes.
 *
 * Installed JavaScript packages stay outside the bundle and load from node_modules as they do
 * today; the app's own code, linked workspace packages and packages that ship TypeScript source
 * are bundled. Each bundled file keeps its own
 * `import.meta.url`, so paths it resolves relative to itself (`../dist`, migrations) still point at
 * the source tree. Build in the folder the app runs from, as the image's build step does.
 * @param options - Root, entries and output folder.
 * @returns The files written and the apps compiled in.
 */
export async function buildServer(options: BuildServerOptions): Promise<ServerBuild> {
	const { build } = await import('esbuild');
	const root = resolve(options.directory);
	const outdir = resolve(root, options.outdir ?? SERVER_BUILD_DIRECTORY);
	if (!options.entries.length) throw new Error('Name at least one server entry, such as server/index.ts.');
	const entries = options.entries.map(entry => {
		const file = resolve(root, entry);
		if (isAbsolute(entry) || relative(root, file).startsWith('..')) throw new Error(`Server entries must be inside the app: ${entry}`);
		return { name: basename(entry, extname(entry)), file };
	});
	const names = new Set(entries.map(entry => entry.name));
	if (names.size !== entries.length) throw new Error('Server entries need different file names.');
	// Sub apps are imported by path at runtime; compiling the TypeScript ones in avoids loading each through tsx.
	const apps = discoverApps(root).map(app => app.entry).filter(entry => TYPESCRIPT.test(entry));

	const plugin: Plugin = {
		name: 'db3-server',
		setup(esbuild) {
			// Each output entry first records the compiled apps and its source path, then runs the real entry.
			esbuild.onResolve({ filter: /^db3-entry:/ }, args => ({ path: args.path.slice('db3-entry:'.length), namespace: 'db3-entry' }));
			esbuild.onLoad({ filter: /.*/, namespace: 'db3-entry' }, args => ({
				resolveDir: root, loader: 'js',
				contents: `import ${JSON.stringify(`db3-argv:${args.path}`)};\nimport 'db3-compiled-apps';\nimport ${JSON.stringify(args.path)};\n`,
			}));
			// The entry sees its source file as the script node ran, so `import.meta.url === pathToFileURL(process.argv[1]).href` still finds the main module.
			esbuild.onResolve({ filter: /^db3-argv:/ }, args => ({ path: args.path.slice('db3-argv:'.length), namespace: 'db3-argv' }));
			esbuild.onLoad({ filter: /.*/, namespace: 'db3-argv' }, args => {
				const output = resolve(outdir, `${entries.find(entry => entry.file === args.path)!.name}.mjs`);
				return {
					resolveDir: root, loader: 'js',
					contents: `import { realpathSync } from 'node:fs';\nconst real = file => { try { return realpathSync(file); } catch { return file; } };\nif (process.argv[1] && real(process.argv[1]) === real(${JSON.stringify(output)})) process.argv[1] = ${JSON.stringify(args.path)};\n`,
				};
			});
			esbuild.onResolve({ filter: /^db3-compiled-apps$/ }, () => ({ path: 'apps', namespace: 'db3-apps' }));
			esbuild.onLoad({ filter: /.*/, namespace: 'db3-apps' }, () => ({
				resolveDir: root, loader: 'js',
				contents: `globalThis[Symbol.for(${JSON.stringify(COMPILED_APPS.description)})] = {\n${apps.map(file => `\t${JSON.stringify(file)}: () => import(${JSON.stringify(file)}),`).join('\n')}\n};\n`,
			}));
			// Installed packages load from node_modules at runtime, by the file esbuild resolved.
			esbuild.onResolve({ filter: /^[^./]/ }, async args => {
				if (args.pluginData?.db3 || args.path.startsWith('node:') || args.namespace !== 'file') return undefined;
				const found = await esbuild.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { db3: true } });
				if (found.errors.length || !found.path) return undefined;
				if (found.external) return { path: args.path, external: true };
				return external(found.path) ? { path: found.path, external: true } : { path: found.path };
			});
			// Gives every bundled module its own location instead of the bundle's.
			esbuild.onLoad({ filter: SOURCE }, async args => {
				if (external(args.path)) return undefined;
				const source = await readFile(args.path, 'utf8');
				if (!source.includes('import.meta.')) return undefined;
				const values = { url: pathToFileURL(args.path).href, dirname: dirname(args.path), filename: args.path };
				return { contents: source.replace(META, (_, key: keyof typeof values) => JSON.stringify(values[key])), loader: loaders[extname(args.path) as keyof typeof loaders] ?? 'ts', resolveDir: dirname(args.path) };
			});
		},
	};

	await build({
		absWorkingDir: root,
		entryPoints: Object.fromEntries(entries.map(entry => [entry.name, `db3-entry:${entry.file}`])),
		outdir, outExtension: { '.js': '.mjs' },
		bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node24',
		sourcemap: 'linked', logLevel: 'warning', plugins: [plugin],
		// Bundled CommonJS code calls require; give it one relative to the bundle.
		banner: { js: "import { createRequire as __db3CreateRequire } from 'node:module';\nconst require = __db3CreateRequire(import.meta.url);" },
	});
	return { outputs: entries.map(entry => resolve(outdir, `${entry.name}.mjs`)), apps };
}

/** The `build:server` command, run from an app's production `build` script. */
export function createBuildServerCommand(): CliCommand {
	return {
		name: 'build:server',
		description: 'Compile server entries and local apps to plain JavaScript, so production starts without a TypeScript loader.',
		options: [
			{ name: 'entry', type: 'string', multiple: true, default: ['server/index.ts'], description: 'Server entry file relative to the app root; repeat for each process (web, queue, scheduler).' },
			{ name: 'out', type: 'string', default: SERVER_BUILD_DIRECTORY, description: 'Output folder relative to the app root.' },
		],
		async run(context) {
			const result = await buildServer({ directory: context.directory, entries: context.options.entry as string[], outdir: context.options.out as string });
			context.write(`Built ${result.outputs.map(file => relative(context.directory, file)).join(', ')}${result.apps.length ? ` with ${result.apps.length} app${result.apps.length === 1 ? '' : 's'}` : ''}.`);
		},
	};
}
