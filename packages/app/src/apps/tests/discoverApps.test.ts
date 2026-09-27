import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '@db3.ai/app/server';
import { discoverApps, writeAppTypes } from '@db3.ai/app/apps';

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

/** Creates metadata fixtures whose code must never run during discovery. */
async function directory() {
	const root = await mkdtemp(join(tmpdir(), 'db3-discovery-'));
	temporary.push(root);
	await mkdir(join(root, 'apps/social/client'), { recursive: true });
	await writeFile(join(root, 'apps/social/manifest.json'), JSON.stringify({ name: 'Social', version: '1.0.0' }));
	await writeFile(join(root, 'apps/social/App.ts'), "throw new Error('Discovery executed code');");
	await writeFile(join(root, 'apps/social/client/index.ts'), "throw new Error('Discovery executed client');");
	return root;
}

it('discovers a local folder without registration or code execution and generates optional service types', async () => {
	const root = await directory();
	expect(discoverApps(root)).toMatchObject([{ manifest: { id: 'social' }, entry: join(root, 'apps/social/App.ts') }]);
	await writeAppTypes(root);
	expect(await readFile(join(root, '.db3/apps.d.ts'), 'utf8')).toContain('readonly social?: InstanceType<typeof import("./../apps/social/App.js").default>');
	await rm(join(root, 'apps/social'), { recursive: true });
	expect(discoverApps(root)).toEqual([]);
	await writeAppTypes(root);
	expect(await readFile(join(root, '.db3/apps.d.ts'), 'utf8')).not.toContain('readonly social');
});

it('discovers only marked direct npm dependencies and rejects duplicate names and escaping entries', async () => {
	const root = await directory();
	const dependency = join(root, 'node_modules/@example/social');
	await mkdir(dependency, { recursive: true });
	await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@example/social': '1.0.0' } }));
	await writeFile(join(dependency, 'manifest.json'), JSON.stringify({ name: 'Social', version: '1.0.0' }));
	const metadata = { name: '@example/social', exports: { './package.json': './package.json' }, db3: { app: true, entry: './dist/App.js' } };
	await writeFile(join(dependency, 'package.json'), JSON.stringify(metadata));
	expect(() => discoverApps(root)).toThrow('Duplicate');
	await rm(join(root, 'apps/social'), { recursive: true });
	expect(discoverApps(root)).toMatchObject([{ packageName: '@example/social', entry: join(await realpath(dependency), 'dist/App.js') }]);
	metadata.db3.entry = '../../outside.js';
	await writeFile(join(dependency, 'package.json'), JSON.stringify(metadata));
	expect(() => discoverApps(root)).toThrow('inside');
	await writeFile(join(root, 'package.json'), '{}');
	expect(discoverApps(root)).toEqual([]);
});

it('rejects folder identity mismatches and framework service collisions before app code loads', async () => {
	const root = await directory();
	await writeFile(join(root, 'apps/social/manifest.json'), JSON.stringify({ id: 'other', name: 'Social', version: '1.0.0' }));
	expect(() => discoverApps(root)).toThrow('disagrees');
	await rm(join(root, 'apps/social'), { recursive: true });
	await mkdir(join(root, 'apps/db'));
	await writeFile(join(root, 'apps/db/manifest.json'), JSON.stringify({ name: 'Database', version: '1.0.0' }));
	const host = new App({ directory: root });
	try { expect(() => host.apps).toThrow('reserved'); } finally { await host.close(); }
});


it('rejects prototype-like folder names instead of silently losing them during discovery', async () => {
	const root = await directory();
	await mkdir(join(root, 'apps/__proto__'));
	await writeFile(join(root, 'apps/__proto__/manifest.json'), JSON.stringify({ name: 'Invalid', version: '1.0.0' }));
	expect(() => discoverApps(root)).toThrow('reserved');
});
