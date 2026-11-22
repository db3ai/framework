import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../commands/buildServer';

// Inside the package, so the fixture resolves installed packages from the workspace node_modules.
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const made: string[] = [];
afterEach(async () => { await Promise.all(made.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });

/** Writes a small app with a server entry, a helper that reads its own location, and a local feature app. */
async function fixture() {
	const root = await mkdtemp(join(packageRoot, '.build-server-'));
	made.push(root);
	await mkdir(join(root, 'server', 'lib'), { recursive: true });
	await mkdir(join(root, 'apps', 'notes'), { recursive: true });
	await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module' }));
	// An installed package that ships TypeScript source, as some private packages do.
	await mkdir(join(root, 'node_modules', 'typed-package'), { recursive: true });
	await writeFile(join(root, 'node_modules', 'typed-package', 'package.json'), JSON.stringify({ name: 'typed-package', type: 'module', exports: './index.ts' }));
	await writeFile(join(root, 'node_modules', 'typed-package', 'index.ts'), "export const shout = (text: string): string => text.toUpperCase();\n");
	await writeFile(join(root, 'server', 'lib', 'where.ts'), "export const where: string = import.meta.url;\nexport const folder: string = import.meta.dirname;\n");
	await writeFile(join(root, 'server', 'index.ts'), [
		"import { z } from 'zod';",
		"import { where, folder } from './lib/where';",
		"import { shout } from 'typed-package';",
		"const apps = (globalThis as any)[Symbol.for('db3.compiledApps')] as Record<string, () => Promise<{ default: { title: string } }>>;",
		"const entry = Object.keys(apps)[0]!;",
		"const loaded = await apps[entry]!();",
		"import { pathToFileURL } from 'node:url';",
		"// A guarded entry, as servers that are also imported by tests use.",
		"const main = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;",
		"console.log(JSON.stringify({ where, folder, entry, title: loaded.default.title, parsed: z.number().parse(3), shouted: shout('hi'), main }));",
	].join('\n'));
	await writeFile(join(root, 'server', 'queue.ts'), "console.log('queue');\n");
	await writeFile(join(root, 'apps', 'notes', 'manifest.json'), JSON.stringify({ name: 'Notes', version: '1.0.0', description: 'Notes.' }));
	await writeFile(join(root, 'apps', 'notes', 'App.ts'), "export default class Notes { static title: string = 'Notes app'; }\n");
	return root;
}

describe('db3 build:server', () => {
	/** The output runs with plain node: no TypeScript loader, its own module paths, local apps compiled in. */
	it('compiles entries and local apps so node runs them without tsx', async () => {
		const root = await fixture();
		const result = await buildServer({ directory: root, entries: ['server/index.ts', 'server/queue.ts'] });
		expect(result.outputs).toEqual([join(root, 'dist-server', 'index.mjs'), join(root, 'dist-server', 'queue.mjs')]);
		expect(result.apps).toEqual([join(root, 'apps', 'notes', 'App.ts')]);
		const printed = JSON.parse(execFileSync(process.execPath, [result.outputs[0]!], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } }));
		expect(printed).toEqual({
			where: pathToFileURL(join(root, 'server', 'lib', 'where.ts')).href, folder: join(root, 'server', 'lib'),
			entry: join(root, 'apps', 'notes', 'App.ts'), title: 'Notes app', parsed: 3, shouted: 'HI', main: true,
		});
		expect(execFileSync(process.execPath, [result.outputs[1]!], { cwd: root, encoding: 'utf8' }).trim()).toBe('queue');
		// Installed JavaScript is loaded from node_modules; TypeScript packages are compiled in.
		const bundle = await readFile(result.outputs[0]!, 'utf8');
		expect(bundle).toMatch(/from "[^"]*node_modules\/zod\//);
		expect(bundle).not.toMatch(/from "[^"]*typed-package/);
		expect((await readdir(join(root, 'dist-server'))).some(file => file.startsWith('App-'))).toBe(true);
	});

	/** Entries must stay inside the app and produce distinct output names. */
	it('refuses entries outside the app or with clashing names', async () => {
		const root = await fixture();
		await expect(buildServer({ directory: root, entries: ['../outside.ts'] })).rejects.toThrow('inside the app');
		await expect(buildServer({ directory: root, entries: ['server/index.ts', 'server/lib/index.ts'] })).rejects.toThrow('different file names');
		await expect(buildServer({ directory: root, entries: [] })).rejects.toThrow('at least one');
	});
});
