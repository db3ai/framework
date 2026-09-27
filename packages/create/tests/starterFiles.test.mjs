import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { listStarterFiles } from '../src/starterFiles.mjs';

/** Prevents generated apps and the installed update command from teaching different conventions. */
test('keeps generated and installed agent scaffolds aligned', async () => {
	const generatedInstructions = await readFile(
		fileURLToPath(new URL('../../../apps/starter/AGENTS.md', import.meta.url)),
		'utf8',
	);
	const installedTemplate = await readFile(
		fileURLToPath(new URL('../../app/templates/AGENTS.md', import.meta.url)),
		'utf8',
	);

	assert.equal(generatedInstructions, installedTemplate);
	assert.match(generatedInstructions, /class-owning TypeScript files and Vue components with PascalCase/);
});

/** Verifies the source selector remains safe after normal workspace development. */
test('selects source while excluding local credentials, installs and runtime artifacts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-starter-files-'));
	try {
		for (const path of ['package.json', '.env.example', 'AGENTS.md', 'client/App.vue', 'server/config.ts', 'server/storage/disk.ts', 'tests/app.test.ts', '.env', '.env.production', '.npmrc', 'package-lock.json', 'node_modules/private/index.ts', 'dist/index.html', 'coverage/index.html', 'storage/private.json', 'test-results/results.json', 'server/debug.log', 'electron/package.json', 'electron/src/main.ts', 'electron/out/private-profile.json']) {
			await mkdir(join(root, path, '..'), { recursive: true });
			await writeFile(join(root, path), 'fixture');
		}
		assert.deepEqual((await listStarterFiles(root)).sort(), ['.env.example', 'AGENTS.md', 'client/App.vue', 'package.json', 'server/config.ts', 'server/storage/disk.ts', 'tests/app.test.ts']);
		await symlink(join(root, '.env'), join(root, 'server/credentials.ts'));
		await assert.rejects(listStarterFiles(root), /Symbolic links are forbidden/);
		await rm(join(root, 'server/credentials.ts'));
		await writeFile(join(root, 'private-notes.md'), 'not reviewed');
		await assert.rejects(listStarterFiles(root), /outside the reviewed app roots/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/** Exercises the actual creator from a source checkout and its packaged layout. */
test('generates from the canonical workspace and prefers its bundled release template', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-starter-layout-'));
	try {
		const creator = join(root, 'packages/create');
		const starter = join(root, 'apps/starter');
		await cp(new URL('../src/', import.meta.url), join(creator, 'src'), { recursive: true });
		await mkdir(join(starter, 'client'), { recursive: true });
		await writeFile(join(starter, 'package.json'), JSON.stringify({ name: 'db3-starter', private: true, dependencies: { '@db3.ai/app': '0.1.0' } }));
		await writeFile(join(starter, '.env.example'), 'OPENAI_API_KEY=\n');
		await writeFile(join(starter, 'AGENTS.md'), '# Framework conventions\n\nUse PascalCase for class-owning files.\n');
		await writeFile(join(starter, '.env'), 'OPENAI_API_KEY=local-secret\n');
		await writeFile(join(starter, 'client/App.vue'), '<main>Workspace app</main>');
		const { createProject } = await import(pathToFileURL(join(creator, 'src/createProject.mjs')).href);
		const first = await createProject(join(root, 'first-app'));
		assert.equal(await readFile(join(first, 'client/App.vue'), 'utf8'), '<main>Workspace app</main>');
		assert.match(await readFile(join(first, 'AGENTS.md'), 'utf8'), /PascalCase for class-owning files/);
		assert.equal(await readFile(join(first, '.env'), 'utf8'), 'OPENAI_API_KEY=\n');
		await cp(starter, join(creator, 'template'), { recursive: true });
		await writeFile(join(creator, 'template/client/App.vue'), '<main>Released app</main>');
		const second = await createProject(join(root, 'second-app'));
		assert.equal(await readFile(join(second, 'client/App.vue'), 'utf8'), '<main>Released app</main>');
		await rm(join(root, 'apps'), { recursive: true });
		assert.equal(await readFile(join(await createProject(join(root, 'third-app')), '.env'), 'utf8'), 'OPENAI_API_KEY=\n');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
