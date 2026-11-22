import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { appsPlugin } from '../appsPlugin';
import { staleBuildReloadScript } from '../staleBuildReload';

/** Runs the script against a fake window and returns what one failed chunk load did. */
function failChunkLoads(script: string, times: number) {
	const store = new Map<string, string>();
	const listeners: ((event: { preventDefault(): void }) => void)[] = [];
	let reloads = 0, prevented = 0;
	new Function('addEventListener', 'sessionStorage', 'location', script)(
		(_name: string, listener: (event: { preventDefault(): void }) => void) => listeners.push(listener),
		{ getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
		{ reload: () => { reloads++; } },
	);
	for (let i = 0; i < times; i++) listeners.forEach(listener => listener({ preventDefault: () => { prevented++; } }));
	return { reloads, prevented, store };
}

it('reloads once per build when an old chunk is gone, then lets the error surface', () => {
	expect(failChunkLoads(staleBuildReloadScript('build-a'), 3)).toMatchObject({ reloads: 1, prevented: 1 });
});

it('adds the reload script to built pages only', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-stale-build-'));
	try {
		await mkdir(join(root, 'apps'));
		await writeFile(join(root, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>');
		await writeFile(join(root, 'main.js'), "import('./lazy.js');");
		await writeFile(join(root, 'lazy.js'), 'export default 1;');
		await build({ root, logLevel: 'silent', configFile: false, plugins: [appsPlugin()], build: { outDir: join(root, 'dist') } });
		const html = await readFile(join(root, 'dist/index.html'), 'utf8');
		expect(html.indexOf("addEventListener('vite:preloadError'")).toBeGreaterThan(-1);
		expect(html.indexOf('vite:preloadError')).toBeLessThan(html.indexOf('type="module"'));
		// The lazy import goes through Vite's preload helper, which fires the event the script listens for.
		const scripts = await Promise.all((await readdir(join(root, 'dist/assets'))).map(name => readFile(join(root, 'dist/assets', name), 'utf8')));
		expect(scripts.some(code => code.includes('vite:preloadError'))).toBe(true);
	}
	finally { await rm(root, { recursive: true, force: true }); }
});
