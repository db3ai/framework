import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../src/createProject.mjs';

test('creates an independent app with optional AI and no inherited credentials', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-create-test-'));
	try {
		const target = await createProject(join(root, 'my-app'));
		const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
		assert.equal(manifest.name, 'my-app');
		assert.equal(manifest.dependencies['@db3.ai/app'], '0.1.0');
		assert.match(manifest.scripts['db:make:migration'], /^npm run check && /);
		const env = await readFile(join(target, '.env'), 'utf8');
		assert.match(env, /^OPENAI_API_KEY=$/m);
		assert.match(env, /^DB_PORT=3306$/m);
		assert.match(await readFile(join(target, '.gitignore'), 'utf8'), /^\.env$/m);
		assert.ok((await readdir(target)).includes('src'));
		await assert.rejects(createProject(target), { code: 'EEXIST' });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Docker gets a unique local DB password, never an AI key', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-create-test-'));
	try {
		const one = await createProject(join(root, 'one'), { docker: true });
		const two = await createProject(join(root, 'two'), { docker: true });
		const first = await readFile(join(one, '.env'), 'utf8');
		assert.match(first, /^DB_PORT=33067$/m);
		assert.match(first, /^DB_PASSWORD=[a-f0-9]{48}$/m);
		assert.match(first, /^OPENAI_API_KEY=$/m);
		assert.notEqual(first, await readFile(join(two, '.env'), 'utf8'));
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses existing files, symlinks and unsafe package names without changing them', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-create-test-'));
	try {
		await writeFile(join(root, 'existing'), 'keep');
		await symlink(join(root, 'existing'), join(root, 'link'));
		await assert.rejects(createProject(join(root, 'existing')));
		await assert.rejects(createProject(join(root, 'link')));
		await assert.rejects(createProject(join(root, 'bad name')));
		assert.equal(await readFile(join(root, 'existing'), 'utf8'), 'keep');
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('the CLI never copies an OpenAI key inherited from its launching environment', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-create-test-'));
	try {
		const target = join(root, 'byok-app');
		const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/create.mjs', import.meta.url)), target, '--no-install'], { env: { ...process.env, OPENAI_API_KEY: 'dummy-key-must-not-be-copied' }, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const env = await readFile(join(target, '.env'), 'utf8');
		assert.match(env, /^OPENAI_API_KEY=$/m);
		assert.ok(!env.includes('dummy-key-must-not-be-copied'));
		assert.ok(!result.stdout.includes('dummy-key-must-not-be-copied'));
	} finally { await rm(root, { recursive: true, force: true }); }
});
