import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertPackageInspection } from '../lib/framework-release-policy.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Exercises the complete generated client/server app against installed public packages. */
test('packed Create generates an independent app that installs, builds and passes its SQL integration tests', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-create-consumer-'));
	const environment = {
		...process.env,
		NODE_ENV: 'test',
		DB3_FRAMEWORK_REPOSITORY_URL: '',
		OPENAI_API_KEY: '',
		DATABASE_URL: '',
		DB_CONNECTION: 'mariadb',
		DB_TEST_DATABASE_PREFIX: 'db3_app_test',
		DB_HOST: process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
		DB_PORT: process.env.TEST_DB_PORT || process.env.DB_PORT || '3306',
		DB_USER: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
		DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
		npm_config_cache: join(root, 'npm-cache'),
		TEST_DB_HOST: process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1',
		TEST_DB_PORT: process.env.TEST_DB_PORT || process.env.DB_PORT || '3306',
		TEST_DB_USER: process.env.TEST_DB_USER || process.env.DB_USER || 'root',
		TEST_DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
	};
	try {
		const staged = join(root, 'staged');
		run(process.execPath, [join(repositoryRoot, 'scripts/stage-framework-packages.mjs'), '--output', staged], repositoryRoot, environment);
		const tarballs = {};
		for (const name of ['pure', 'app', 'create']) {
			const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', root], join(staged, name), environment));
			assertPackageInspection({ name: `@db3.ai/${name}`, version: packed.version }, packed);
			tarballs[name] = join(root, packed.filename);
		}
		const launcher = join(root, 'launcher');
		await mkdir(launcher);
		await writeFile(join(launcher, 'package.json'), '{"name":"creator-consumer","private":true,"type":"module"}\n');
		run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballs.create], launcher, environment);
		const target = join(root, 'my-app');
		const creator = join(launcher, 'node_modules/@db3.ai/create/bin/create.mjs');
		run(process.execPath, [creator, target, '--no-install'], launcher, environment);
		const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
		const app = JSON.parse(await readFile(join(staged, 'app/package.json'), 'utf8'));
		assert.equal(manifest.name, 'my-app');
		assert.equal(manifest.dependencies['@db3.ai/app'], app.version);
		assert.equal(manifest.scripts.repl, 'db3 repl');
		assert.equal(manifest.scripts.db3, 'db3');
		for (const file of ['AGENTS.md', 'plans/README.md', 'client/App.vue', 'client/main.ts', 'index.html', 'server/app.ts', 'apps/social/App.ts', 'apps/social/manifest.json', 'scripts/prepareApps.mjs', 'apps/social/tsconfig.build.json', 'server/cli.config.ts', 'server/database/models.ts', 'server/database/schema.snapshot.json', 'tests/app.test.ts', 'vite.config.ts', 'tsconfig.json']) {
			assert.equal(await readFile(join(target, file), 'utf8'), await readFile(join(repositoryRoot, 'apps/starter', file), 'utf8'));
		}
		assert.match(await readFile(join(target, 'AGENTS.md'), 'utf8'), /class-owning TypeScript files and Vue components with PascalCase/);
		assert.deepEqual(await readdir(join(target, 'plans')), ['README.md']);
		assert.ok(!(await readdir(target)).includes('src'));
		assert.ok(!(await readdir(target)).includes('database'));
		assert.ok(!(await readdir(join(target, 'server/database'))).includes('migrations.ts'));
		assert.match(await readFile(join(target, '.env'), 'utf8'), /^OPENAI_API_KEY=$/m);
		run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballs.pure, tarballs.app], target, environment);
		// Use the framework-owned samples rendered in the guide, with no undocumented code edits.
		const fragments = JSON.parse(run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import { helloGuideSamples } from './packages/app/src/apps/examples/helloGuideSamples.ts'; process.stdout.write(JSON.stringify(helloGuideSamples));"], repositoryRoot, environment));
		const guide = [
			{ id: 'hello-test', code: fragments.helloTest },
			{ id: 'hello-test-explicit', code: fragments.helloTestExplicit },
			{ id: 'hello-use', code: fragments.helloUse },
		];
		for (const [id, path] of [['hello-manifest', 'hello/manifest.json'], ['hello-service', 'hello/App.ts'], ['hello-definition', 'helloDefinition.ts']]) {
			guide.push({ id, code: await readFile(join(repositoryRoot, 'packages/app/src/apps/examples', path), 'utf8') });
		}
		await mkdir(join(target, 'apps/hello'), { recursive: true });
		for (const [id, path] of [['hello-manifest', 'apps/hello/manifest.json'], ['hello-service', 'apps/hello/App.ts'], ['hello-definition', 'apps/helloDefinition.ts'], ['hello-test', 'tests/hello.test.ts'], ['hello-use', 'server/greetWithHello.ts']]) {
			const sample = guide.find(item => item.id === id);
			assert.ok(sample?.code, `Missing published guide sample ${id}`);
			await writeFile(join(target, path), sample.code);
		}
		run(npm, ['test', '--', 'tests/hello.test.ts'], target, environment);
		const originalHelloTest = guide.find(item => item.id === 'hello-test').code;
		const explicitEdits = guide.find(item => item.id === 'hello-test-explicit').code;
		const explicitHelloTest = explicitEdits.split('\n')[0] + '\n' + originalHelloTest.replace(/^\tconst host = new App\(.*$/m, '\t' + explicitEdits.split('\n').find(line => line.startsWith('const host =')));
		await writeFile(join(target, 'tests/hello.test.ts'), explicitHelloTest);
		run(npm, ['test', '--', 'tests/hello.test.ts'], target, environment);

		run(npm, ['run', 'check'], target, environment);
		console.log('Published Hello guide: discovery, explicit composition, cleanup and consumer types passed.');

		assert.match(run(process.execPath, [join(target, 'node_modules/@db3.ai/app/bin/db3.mjs'), '--help'], target, environment), /db:make-migration/);
		// Exercise a real model change through the generated app's migration CLI.
		const migrationDirectory = join(target, 'server/database/migrations');
		const previousMigrations = await readdir(migrationDirectory);
		const modelFile = join(target, 'server/models/Note.ts');
		const modelSource = await readFile(modelFile, 'utf8');
		assert.match(modelSource, /\t\t\tid: field\.ulid\(\),/);
		await writeFile(modelFile, modelSource.replace('\t\t\tid: field.ulid(),', '\t\t\tid: field.ulid(),\n\t\t\tsubtitle: field.string({ required: false, maxLength: 160 }),'));
		run(npm, ['run', 'db:make:migration', '--', 'add_note_subtitle'], target, environment);
		const newMigrations = (await readdir(migrationDirectory)).filter(file => !previousMigrations.includes(file));
		assert.equal(newMigrations.length, 1);
		assert.match(newMigrations[0], /_add_note_subtitle\.ts$/);
		const snapshot = JSON.parse(await readFile(join(target, 'server/database/schema.snapshot.json'), 'utf8'));
		assert.ok(snapshot.tables.find(table => table.name === 'notes').columns.some(column => column.name === 'subtitle'));
		assert.ok(!(await readdir(target)).includes('database'));
		// Verify the installed executable applies and checks those files, then exits cleanly.
		await writeFile(join(target, 'cli-smoke.mjs'), `import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { runDb3 } from '@db3.ai/app/cli';
const directory = fileURLToPath(new URL('.', import.meta.url));
const database = await createGeneratedTestDatabase('cli');
try {
	const env = { ...process.env, DB_DATABASE: database.databaseName };
	for (const [command, expected] of [['db:check', 1], ['db:migrate', 0], ['db:check', 0], ['db:migrate', 0]]) {
		const result = spawnSync(process.execPath, ['node_modules/@db3.ai/app/bin/db3.mjs', command], { env, encoding: 'utf8', timeout: 30_000 });
		assert.equal(result.status, expected, result.stdout + result.stderr);
	}
	for (const args of [['apps:list'], ['apps:install', 'hello'], ['apps:disable', 'hello'], ['apps:enable', 'hello'], ['apps:uninstall', 'hello'], ['apps:make-migration', 'social', 'no_change'], ['apps:install', 'social'], ['apps:disable', 'social'], ['apps:enable', 'social'], ['apps:uninstall', 'social']]) {
		const result = spawnSync(process.execPath, ['node_modules/@db3.ai/app/bin/db3.mjs', ...args], { env, encoding: 'utf8', timeout: 30_000 });
		assert.equal(result.status, 0, result.stdout + result.stderr);
	}
	// Run the generated app's npm shortcut and query the real migrated database.
	await new Promise((resolve, reject) => {
		const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'repl'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
		let output = '';
		let errors = '';
		let sent = false;
		const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Installed REPL timed out: ' + output + errors)); }, 30_000);
		child.stdout.on('data', chunk => {
			output += chunk.toString();
			if (!sent && output.includes('db3> ')) {
				sent = true;
				child.stdin.write('JSON.stringify({ rows: await Note.query().limit(1).all(), registry: models.Note === Note, db: app().db.knex.client.config.connection.database })' + '\\n');
			} else if (sent && (output.match(/db3> /g)?.length ?? 0) >= 2) child.stdin.end('.exit' + '\\n');
		});
		child.stderr.on('data', chunk => { errors += chunk.toString(); });
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('close', status => {
			clearTimeout(timer);
			try {
				assert.equal(status, 0, output + errors);
				assert.ok(output.includes(JSON.stringify({ rows: [], registry: true, db: database.databaseName })), output);
				resolve();
			} catch (error) { reject(error); }
		});
	});
	// Embedded callers may select an app while their process is running elsewhere.
	process.env.DB_DATABASE = database.databaseName;
	process.chdir('..');
	assert.equal(await runDb3(['db:check'], { directory }), 0);
} finally { await database.destroy(); }
`);
		run(process.execPath, ['cli-smoke.mjs'], target, environment);
		// The guide's CLI smoke has uninstalled Hello. Remove only its disposable
		// consumer files before exercising the unchanged Starter's own catalogue tests.
		for (const path of ['apps/hello', 'apps/helloDefinition.ts', 'tests/hello.test.ts', 'server/greetWithHello.ts']) {
			await rm(join(target, path), { recursive: true, force: true });
		}

		// Exercise framework-owned examples against installed public packages.
		await mkdir(join(target, 'tests/examples'), { recursive: true });
		await mkdir(join(target, 'tests/ai'), { recursive: true });
		for (const file of ['HelpAgent.ts', 'Conversation.ts', 'createHelpImage.ts', 'prepareDocumentEmbeddings.ts']) {
			const source = await readFile(join(repositoryRoot, 'packages/app/src/ai/examples', file), 'utf8');
			await writeFile(join(target, 'tests/examples', file), source);
		}
		const aiTest = await readFile(join(repositoryRoot, 'packages/app/src/ai/tests/Ai.integration.test.ts'), 'utf8');
		await writeFile(join(target, 'tests/ai/Ai.integration.test.ts'), aiTest);
		run(process.execPath, [join(target, 'node_modules/@db3.ai/app/bin/db3.mjs'), 'queue:make-job', 'GenerateReportJob'], target, environment);
		await writeFile(join(target, 'tests/generated-job.test.ts'), `import { expect, it } from 'vitest';
import { GenerateReportJob } from '../server/jobs/GenerateReportJob';
it('validates generated payloads and refuses to silently consume unfinished work', async () => {
	expect(() => new GenerateReportJob({ message: '' })).toThrow('requires a message');
	await expect(new GenerateReportJob({ message: 'Hello' }).handle()).rejects.toThrow('Implement GenerateReportJob.handle()');
});
`);
		run(npm, ['run', 'build'], target, environment);
		run(npm, ['test'], target, environment);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/**
 * Runs a consumer command and reports its output without exposing environment values.
 *
 * @param {string} command - Executable to run.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Isolated consumer directory.
 * @param {NodeJS.ProcessEnv} env - Explicit test environment, including test-only SQL credentials.
 * @returns {string} Captured standard output.
 */
function run(command, args, cwd, env) {
	const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 300_000 });
	assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
	return result.stdout;
}
