import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
/** Runs one controlled consumer command, preserving diagnostics on failure. */
function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false', npm_config_cache: join(temporary, 'npm-cache') } });
	if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Consumer command failed.');
	return result.stdout;
}
const temporary = await mkdtemp(join(tmpdir(), 'intercom-consumer-'));
try {
	const staged = join(temporary, 'package'); const consumer = join(temporary, 'consumer');
	await mkdir(staged); await mkdir(consumer);
	run(process.execPath, [join(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-p', join(packageRoot, 'tsconfig.json'), '--outDir', join(staged, 'dist'), '--declaration', 'true', '--sourceMap', 'false', '--declarationMap', 'false'], repositoryRoot);
	const source = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
	await writeFile(join(staged, 'package.json'), JSON.stringify({ name: source.name, version: source.version, type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, files: ['dist', 'README.md'] }));
	await cp(join(packageRoot, 'README.md'), join(staged, 'README.md'));
	const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], staged))[0];
	if (packed.files.some(file => file.path.includes('/tests/') || file.path.startsWith('src/'))) throw new Error('Package included source tests.');
	await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
	run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], consumer);
	await writeFile(join(consumer, 'runtime.mjs'), `import { IntercomNotifications } from '@db3.ai/notifications-intercom';\nlet sent = false;\nglobalThis.fetch = async url => String(url).endsWith('/contacts/search') ? Response.json({ data: [{ id: 'contact', role: 'user' }] }) : (sent = true, new Response(null, { status: 202 }));\nawait new IntercomNotifications({ accessToken: 'test' }).send('user', 'onboarding_notification', { count: 1 });\nif (!sent) throw new Error('No event submitted');\n`);
	run(process.execPath, ['runtime.mjs'], consumer);
	await writeFile(join(consumer, 'consumer.ts'), `import { IntercomNotifications, type IntercomEventMetadata } from '@db3.ai/notifications-intercom';\nconst data: IntercomEventMetadata = { report_url: 'https://example.test/report' };\nvoid new IntercomNotifications({ accessToken: 'test' }).send('user', 'onboarding_notification', data);\n`);
	await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, types: [], lib: ['ES2022', 'DOM'] }, include: ['consumer.ts'] }));
	run(process.execPath, [join(repositoryRoot, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], consumer);
	console.log('Packed Intercom package: independent runtime and TypeScript consumer passed.');
} finally { await rm(temporary, { recursive: true, force: true }); }
