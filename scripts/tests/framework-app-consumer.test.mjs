import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Runs a consumer command with captured diagnostics and a bounded deadline. */
function run(command, args, cwd, env = process.env) {
	const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
	assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
	return result.stdout;
}

test('a packed app installs, types, migrates and survives real npm uninstall and reinstall', { timeout: 600_000 }, async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'db3-app-consumer-'));
	try {
		const staged = join(temporary, 'staged');
		const consumer = join(temporary, 'consumer');
		const env = { ...process.env, DB3_FRAMEWORK_REPOSITORY_URL: '' };
		run(process.execPath, [join(root, 'scripts/stage-framework-packages.mjs'), '--package', 'pure', '--package', 'app', '--output', staged], root, env);
		const tarballs = [];
		for (const packageRoot of [join(staged, 'pure'), join(staged, 'app'), join(root, 'apps/starter/apps/social')]) {
			const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], packageRoot, env));
			tarballs.push(join(temporary, packed.filename));
		}
		await mkdir(consumer);
		await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'app-package-proof', private: true, type: 'module' }));
		run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', ...tarballs, '@types/node@^25', 'vue@^3.5', 'fastify@^5', 'tailwindcss@^4'], consumer, env);
		await cp(join(root, 'scripts/fixtures/apps-consumer'), consumer, { recursive: true });
		await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: true }, include: ['consumer.ts', '.db3/apps.d.ts'] }));
		run(process.execPath, ['prepare.mjs'], consumer, env);
		run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', '.'], consumer, env);
		const metadata = JSON.parse(await readFile(join(consumer, 'node_modules/@db3.ai/app/package.json'), 'utf8'));
		const pluginEntry = metadata.exports['./apps/vite'].import ?? metadata.exports['./apps/vite'];
		const { appsPlugin } = await import(pathToFileURL(join(consumer, 'node_modules/@db3.ai/app', pluginEntry)).href);
		await build({ configFile: false, plugins: [appsPlugin(), tailwindcss()], root: consumer, logLevel: 'silent', build: { lib: { entry: join(consumer, 'client.mjs'), formats: ['es'] }, outDir: join(consumer, 'browser-dist') } });
		const cssFile = (await readdir(join(consumer, 'browser-dist'))).find(file => file.endsWith('.css'));
		assert.ok(cssFile, 'Discovered app browser build emits CSS');
		assert.match(await readFile(join(consumer, 'browser-dist', cssFile), 'utf8'), /\.grid\s*\{\s*display:\s*grid/, 'Packaged app utilities are found without a host CSS registration');
		const original = await readFile(join(root, 'apps/starter/apps/social/database/migrations/20260926000100_social_opportunities.mjs'), 'utf8');
		assert.equal(await readFile(join(consumer, 'node_modules/@db3.ai/social/dist/database/migrations/20260926000100_social_opportunities.mjs'), 'utf8'), original);
		const runtime = run(process.execPath, ['runtime.mjs'], consumer, { ...env, SOCIAL_TARBALL: tarballs[2] });
		assert.match(runtime, /installed -> removed -> restored; data preserved/);
	} finally { await rm(temporary, { recursive: true, force: true }); }
});
