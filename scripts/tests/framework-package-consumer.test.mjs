import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STAGING_SCRIPT = join(REPOSITORY_ROOT, 'scripts', 'stage-framework-packages.mjs');
const TYPESCRIPT_CLI = join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const PUBLIC_APP_PACKAGE = '@db3.ai/app';
const PUBLIC_PURE_PACKAGE = '@db3.ai/pure';
const SOURCE_APP_MANIFEST = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'packages', 'app', 'package.json'), 'utf8'));
const SOURCE_PURE_MANIFEST = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'packages', 'pure', 'package.json'), 'utf8'));
const SOURCE_ONLY_PACKAGE_NAMES = [SOURCE_APP_MANIFEST.name, SOURCE_PURE_MANIFEST.name]
	.filter((name) => ![PUBLIC_APP_PACKAGE, PUBLIC_PURE_PACKAGE].includes(name));

test('Pure tarball includes the documented public-import examples', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'db3-pure-assets-'));
	try {
		const environment = { ...process.env, DB3_FRAMEWORK_REPOSITORY_URL: '', npm_config_cache: join(temporaryRoot, 'npm-cache') };
		const stagedRoot = join(temporaryRoot, 'staged');
		runCommand(process.execPath, [STAGING_SCRIPT, '--package', 'pure', '--output', stagedRoot], REPOSITORY_ROOT, environment);
		const packageRoot = join(stagedRoot, 'pure');
		const [packed] = JSON.parse(runCommand(NPM_COMMAND, ['pack', '--json', '--pack-destination', temporaryRoot], packageRoot, environment));
		for (const filename of ['selectNoteTags.ts', 'runNoteTags.ts']) {
			assert.ok(packed.files.some(file => file.path === `examples/${filename}`), `Missing packed example ${filename}`);
			const source = await readFile(join(packageRoot, 'examples', filename), 'utf8');
			assert.doesNotMatch(source, /@platform\//);
		}
		assert.equal(packed.files.some(file => file.path.startsWith('tests/')), false);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('staged framework packages install, run and type-check in a temporary consumer', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'db3-framework-consumer-'));
	const stagedRoot = join(temporaryRoot, 'staged');
	const releaseMetadataRoot = join(temporaryRoot, 'release-metadata');
	const tarballRoot = join(temporaryRoot, 'tarballs');
	const consumerRoot = join(temporaryRoot, 'consumer');
	const stagingEnvironment = {
		...process.env,
		DB3_FRAMEWORK_REPOSITORY_URL: '',
	};
	const npmEnvironment = {
		...process.env,
		npm_config_cache: join(temporaryRoot, 'npm-cache'),
	};

	try {
		runCommand(process.execPath, [STAGING_SCRIPT, '--output', stagedRoot], REPOSITORY_ROOT, stagingEnvironment);
		await assertStagedManifest(join(stagedRoot, 'pure'), PUBLIC_PURE_PACKAGE, false);
		await assertStagedManifest(join(stagedRoot, 'app'), PUBLIC_APP_PACKAGE, true);
		await assertReleaseMetadataMode(releaseMetadataRoot);
		assertInvalidRepositoryUrlIsRejected(temporaryRoot);

		await mkdir(tarballRoot, { recursive: true });
		const pureTarball = packPackage(join(stagedRoot, 'pure'), tarballRoot, npmEnvironment);
		const appTarball = packPackage(join(stagedRoot, 'app'), tarballRoot, npmEnvironment);

		await mkdir(consumerRoot, { recursive: true });
		await writeFile(join(consumerRoot, 'package.json'), `${JSON.stringify({
			name: 'db3-framework-package-consumer',
			private: true,
			type: 'module',
			devDependencies: {
				'@types/node': SOURCE_APP_MANIFEST.devDependencies['@types/node'],
			},
		}, null, '\t')}\n`, 'utf8');

		runCommand(NPM_COMMAND, [
			'install',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			'--package-lock=false',
			pureTarball,
			appTarball,
		], consumerRoot, npmEnvironment);

		await assertConsumerAssets(consumerRoot);
		await writeConsumerFixtures(consumerRoot, stagedRoot);
		runCommand(process.execPath, ['runtime.mjs'], consumerRoot);
		runCommand(process.execPath, [TYPESCRIPT_CLI, '-p', 'tsconfig.json'], consumerRoot);

		const scaffoldExecutable = join(
			consumerRoot,
			'node_modules',
			'.bin',
			process.platform === 'win32' ? 'db3-agents.cmd' : 'db3-agents',
		);

		runCommand(scaffoldExecutable, ['--target', 'AGENTS.md'], consumerRoot);
		assert.match(await readFile(join(consumerRoot, 'AGENTS.md'), 'utf8'), /@db3\.ai\/app:start/);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

/**
 * Verifies the generated manifest has compiled runtime and declaration exports.
 *
 * @param {string} packageRoot - Staged package root.
 * @param {string} expectedName - Public package name expected in the artifact.
 * @param {boolean} expectAgentAssets - Whether application agent assets are required.
 * @returns {Promise<void>}
 */
async function assertStagedManifest(packageRoot, expectedName, expectAgentAssets) {
	const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

	assert.equal(manifest.name, expectedName);
	assert.equal(manifest.private, undefined);
	assert.equal(manifest.repository, undefined);
	assert.equal(manifest.publishConfig.access, 'public');
	assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org/');
	assert.equal(manifest.publishConfig.provenance, undefined);
	assert.equal(manifest.engines.node, '>=20');
	assert.match(manifest.main, /^\.\/dist\/.*\.js$/);
	assert.match(manifest.types, /^\.\/dist\/.*\.d\.ts$/);
	assert.match(manifest.exports['.'].import, /^\.\/dist\/.*\.js$/);
	assert.match(manifest.exports['.'].types, /^\.\/dist\/.*\.d\.ts$/);
	assert.doesNotMatch(JSON.stringify(manifest.exports), /\.\/src\/.*\.ts/);

	await access(join(packageRoot, manifest.main), constants.R_OK);
	await access(join(packageRoot, manifest.types), constants.R_OK);
	await access(join(packageRoot, 'README.md'), constants.R_OK);

	if (expectAgentAssets) {
		assert.equal(typeof manifest.dependencies['thread-stream'], 'string');
		assert.equal(manifest.dependencies[PUBLIC_PURE_PACKAGE], manifest.version);

		if (SOURCE_PURE_MANIFEST.name !== PUBLIC_PURE_PACKAGE) {
			assert.equal(manifest.dependencies[SOURCE_PURE_MANIFEST.name], undefined);
		}

		assert.deepEqual(manifest.bin, {
			'db3-agents': 'bin/db3-agents.mjs',
		});
		await access(join(packageRoot, 'agent-instructions.md'), constants.R_OK);
		await access(join(packageRoot, 'bin', 'db3-agents.mjs'), constants.X_OK);
		await access(join(packageRoot, 'templates', 'AGENTS.md'), constants.R_OK);
		await access(join(packageRoot, 'src', 'mail', 'Mail.ts'), constants.R_OK);
		await access(join(packageRoot, 'src', 'server', 'App.ts'), constants.R_OK);
		await access(join(packageRoot, 'src', 'queue', 'README.md'), constants.R_OK);
		await access(join(packageRoot, 'src', 'queue', 'examples', 'GenerateReportJob.ts'), constants.R_OK);
		for (const example of ['KnowledgeNote.ts', 'workspaceNotes.ts', 'createNotesTogether.ts', 'runWorkspaceNotes.ts', 'outputs/workspace-notes.json']) {
			await access(join(packageRoot, 'src', 'db', 'examples', example), constants.R_OK);
		}
		for (const [service, examples] of Object.entries({
			flows: ['FlowExampleApp.ts', 'createTextFlow.ts', 'normalizeTextBlock.ts', 'uppercaseTextBlock.ts', 'runTextFlow.ts'],
			url: ['runApplicationLinks.ts'],
			serialization: ['ExportRequest.ts', 'runExportSerialization.ts'],
			ssr: ['createPublicPageServer.ts', 'runPublicPages.ts'],
			config: ['loadNotesConfig.ts', 'runConfig.ts'],
			db: ['NoteCodeField.ts', 'FieldNote.ts', 'runFieldNotes.ts', 'runNoteMigrations.ts'],
			cache: ['runNoteCache.ts'],
			events: ['NoteSaved.ts', 'runNoteEvents.ts'],
			logging: ['runNoteLogs.ts'],
			security: ['runSecretRoundTrip.ts'],
			validation: ['validateNoteInput.ts', 'runNoteValidation.ts'],
			mail: ['welcomeMessage.ts', 'runMailPreview.ts'],
			auth: ['runPasswordAuth.ts'],
			queue: ['WriteReportJob.ts', 'runQueueReports.ts', 'runQueueWorkflows.ts', 'DeferredReportJob.ts', 'runBackpressure.ts', 'reportConsole.ts', 'outputs/queue-reports.json'],
			storage: ['runStorage.ts', 'writeCsvExport.ts', 'runStreamExport.ts'],
			media: ['runProjectMedia.ts', 'createPrivateFileServer.ts', 'runPrivateFiles.ts'],
			scheduler: ['WriteDailySummaryJob.ts', 'registerDailySummary.ts', 'runDailySummary.ts', 'RecoverableSummaryJob.ts', 'runScheduledReplay.ts'],
			server: ['createFirstServer.ts', 'startFirstServer.ts'],
		})) {
			for (const example of examples) await access(join(packageRoot, 'src', service, 'examples', example), constants.R_OK);
			await assert.rejects(access(join(packageRoot, 'src', service, 'tests'), constants.F_OK));
		}
		await assert.rejects(access(join(packageRoot, 'src', 'db', 'tests'), constants.F_OK));
		await assert.rejects(access(join(packageRoot, 'src', 'queue', 'tests'), constants.F_OK));
	}

	await assertRelativeMarkdownLinks(packageRoot);
	await assertNoSourceOnlyPackageReferences(packageRoot);
}

/**
 * Verifies every shipped text asset omits source-only workspace package names.
 *
 * @param {string} packageRoot - Staged package tree to inspect.
 * @returns {Promise<void>}
 */
async function assertNoSourceOnlyPackageReferences(packageRoot) {
	for (const filePath of await listFiles(packageRoot)) {
		if (!/\.(?:d\.ts|js|json|md|mjs|ts)$/.test(filePath)) continue;

		const content = await readFile(filePath, 'utf8');

		for (const packageName of SOURCE_ONLY_PACKAGE_NAMES) {
			assert.equal(content.includes(packageName), false, `${filePath} contains source-only package name ${packageName}.`);
		}
	}
}

/**
 * Verifies explicit public-source metadata enables provenance without guesses.
 *
 * @param {string} stageRoot - Temporary output root for release-mode staging.
 * @returns {Promise<void>}
 */
async function assertReleaseMetadataMode(stageRoot) {
	const repositoryUrl = 'git+https://github.com/example-org/db3-framework.git';

	runCommand(process.execPath, [
		STAGING_SCRIPT,
		'--output',
		stageRoot,
		'--repository-url',
		repositoryUrl,
	], REPOSITORY_ROOT);

	const pureManifest = JSON.parse(await readFile(join(stageRoot, 'pure', 'package.json'), 'utf8'));
	const appManifest = JSON.parse(await readFile(join(stageRoot, 'app', 'package.json'), 'utf8'));

	assert.deepEqual(pureManifest.repository, {
		type: 'git',
		url: repositoryUrl,
		directory: 'packages/pure',
	});
	assert.deepEqual(appManifest.repository, {
		type: 'git',
		url: repositoryUrl,
		directory: 'packages/app',
	});
	assert.equal(pureManifest.publishConfig.provenance, true);
	assert.equal(appManifest.publishConfig.provenance, true);
	assert.equal(appManifest.version, pureManifest.version);
	assert.equal(appManifest.dependencies[PUBLIC_PURE_PACKAGE], pureManifest.version);
}

/**
 * Verifies staging rejects ambiguous or non-GitHub provenance metadata.
 *
 * @param {string} temporaryRoot - Isolated root available for a rejected stage.
 * @returns {void}
 */
function assertInvalidRepositoryUrlIsRejected(temporaryRoot) {
	const result = spawnSync(process.execPath, [
		STAGING_SCRIPT,
		'--package',
		'pure',
		'--output',
		join(temporaryRoot, 'invalid-repository'),
		'--repository-url',
		'https://example.com/framework.git',
	], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		stdio: 'pipe',
	});

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /git\+https:\/\/github\.com\/<owner>\/<repo>\.git/);
}

/**
 * Verifies every relative link in packaged Markdown resolves inside the artifact.
 *
 * @param {string} packageRoot - Staged package root.
 * @returns {Promise<void>}
 */
async function assertRelativeMarkdownLinks(packageRoot) {
	for (const filePath of await listMarkdownFiles(packageRoot)) {
		const markdown = await readFile(filePath, 'utf8');
		const links = markdown.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)(?:\s+"[^"]*")?\)/g);

		for (const link of links) {
			const target = decodeURIComponent(link[1].split('#')[0]);

			if (!target) continue;

			const targetPath = resolve(dirname(filePath), target);

			try {
				await access(targetPath, constants.R_OK);
			} catch {
				throw new Error(`Packaged Markdown link "${link[1]}" from ${filePath} does not resolve.`);
			}
		}
	}
}

/**
 * Recursively lists Markdown files included in a staged package.
 *
 * @param {string} directory - Directory to inspect.
 * @returns {Promise<string[]>} Absolute Markdown paths.
 */
async function listMarkdownFiles(directory) {
	const files = [];

	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...await listMarkdownFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			files.push(entryPath);
		}
	}

	return files;
}

/**
 * Recursively lists every file below a staged package directory.
 *
 * @param {string} directory - Directory to inspect.
 * @returns {Promise<string[]>} Absolute staged file paths.
 */
async function listFiles(directory) {
	const files = [];

	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...await listFiles(entryPath));
		} else if (entry.isFile()) {
			files.push(entryPath);
		}
	}

	return files;
}

/**
 * Packs one staged package and returns its absolute tarball path.
 *
 * @param {string} packageRoot - Staged package root.
 * @param {string} destination - Directory that receives the tarball.
 * @param {NodeJS.ProcessEnv} environment - Isolated npm environment.
 * @returns {string} Absolute tarball path.
 */
function packPackage(packageRoot, destination, environment) {
	const output = runCommand(NPM_COMMAND, [
		'pack',
		'--json',
		'--pack-destination',
		destination,
	], packageRoot, environment);
	const result = JSON.parse(output);

	assert.equal(result.length, 1);

	return join(destination, result[0].filename);
}

/**
 * Confirms installed documentation and package-owned AI assets survived packing.
 *
 * @param {string} consumerRoot - Temporary consumer project root.
 * @returns {Promise<void>}
 */
async function assertConsumerAssets(consumerRoot) {
	const appRoot = join(consumerRoot, 'node_modules', '@db3.ai', 'app');
	for (const filename of ['selectNoteTags.ts', 'runNoteTags.ts']) {
		await access(join(consumerRoot, 'node_modules', '@db3.ai', 'pure', 'examples', filename), constants.R_OK);
	}

	await access(join(appRoot, 'agent-instructions.md'), constants.R_OK);
	await access(join(appRoot, 'templates', 'AGENTS.md'), constants.R_OK);
	await access(join(appRoot, 'src', 'queue', 'README.md'), constants.R_OK);
	await access(join(appRoot, 'src', 'queue', 'examples', 'outputs', 'create-and-process-report-job.json'), constants.R_OK);
	for (const example of ['KnowledgeNote.ts', 'workspaceNotes.ts', 'createNotesTogether.ts', 'runWorkspaceNotes.ts', 'outputs/workspace-notes.json']) {
		await access(join(appRoot, 'src', 'db', 'examples', example), constants.R_OK);
	}
}

/**
 * Writes runtime and type-only consumer fixtures against public package subpaths.
 *
 * @param {string} consumerRoot - Temporary consumer project root.
 * @param {string} stagedRoot - Parent directory containing staged manifests.
 * @returns {Promise<void>}
 */
async function writeConsumerFixtures(consumerRoot, stagedRoot) {
	const pureManifest = JSON.parse(await readFile(join(stagedRoot, 'pure', 'package.json'), 'utf8'));
	const appManifest = JSON.parse(await readFile(join(stagedRoot, 'app', 'package.json'), 'utf8'));
	const runtimeSpecifiers = [
		...publicRuntimeSpecifiers(PUBLIC_PURE_PACKAGE, pureManifest.exports),
		...publicRuntimeSpecifiers(PUBLIC_APP_PACKAGE, appManifest.exports),
	];

	await writeFile(join(consumerRoot, 'runtime.mjs'), `
import { createRequire } from 'node:module';
import { normalizedKey } from '@db3.ai/pure';
import { Config } from '@db3.ai/app/config';
import { validate } from '@db3.ai/app/validation';
import { Log, PinoLoggerDriver } from '@db3.ai/app/logging';
import { createSsrRenderContext, renderSsrDocument, SSR_APP_MARKER, SSR_STATE_MARKER } from '@db3.ai/app/ssr';

const require = createRequire(import.meta.url);
const config = new Config({ app: { name: 'Consumer' } });
const result = validate({ name: 'Platform' }, { name: ['required', 'string'] });

if (normalizedKey('  Typed   API ') !== 'typed api') throw new Error('Pure runtime export failed.');
if (config.get('app.name') !== 'Consumer') throw new Error('App runtime export failed.');
if (!result.valid) throw new Error('Validation runtime export failed.');
const renderContext = createSsrRenderContext({ method: 'GET', url: '/', headers: {} });
const literalMarkup = '<main>Literal $& ' + SSR_STATE_MARKER + '</main>';
const rendered = renderSsrDocument(SSR_APP_MARKER + '<script>' + SSR_STATE_MARKER + '</script>', renderContext, { appHtml: literalMarkup });
if (rendered !== literalMarkup + '<script>{}</script>') throw new Error('SSR literal replacement regression.');
const logLines = [];
const log = new Log({ driver: new PinoLoggerDriver({ level: 'info', devtools: false }, { write(line) { logLines.push(line); } }) });
log.debug('before');
log.level = 'debug';
log.debug('after');
log.level = 'silent';
log.error('disabled');
await log.close();
if (logLines.length !== 1 || JSON.parse(logLines[0]).msg !== 'after') throw new Error('Logging runtime level change failed.');
if (!require.resolve('@db3.ai/app/agent-instructions').endsWith('agent-instructions.md')) {
	throw new Error('Agent instructions export failed.');
}

for (const specifier of ${JSON.stringify(runtimeSpecifiers)}) {
	await import(specifier);
}
`, 'utf8');

	await writeFile(join(consumerRoot, 'typecheck.ts'), `
import { Config } from '@db3.ai/app/config';
import { StringField } from '@db3.ai/app/db/fields/StringField';
import type { FieldConfig } from '@db3.ai/app/db/FieldType';
import type { QueueDriver, QueueJob } from '@db3.ai/app/queue';
import type { AppOptions } from '@db3.ai/app/server';
import type { TextResponsePayload } from '@db3.ai/pure/ai';
import { OpenAIText } from '@db3.ai/app/ai';
import type { TextResult } from '@db3.ai/app/ai';
import { Log, type Logger } from '@db3.ai/app/logging';
import { createSsrRenderContext, renderSsrDocument, SSR_APP_MARKER } from '@db3.ai/app/ssr';

const config = new Config({ app: { name: 'Consumer' } } as const);
const fieldConfig: FieldConfig = { required: true };
const field = new StringField(fieldConfig);
const driver = null as QueueDriver | null;
const job = null as QueueJob | null;
const appOptions = {} as AppOptions;
const response: TextResponsePayload = { output_text: 'ok' };
const ai = new OpenAIText({ apiKey: 'test-only-not-used', model: 'test' });
const textResult = null as TextResult | null;
const log: Logger = new Log({ level: 'silent', devtools: false });
const document = renderSsrDocument(SSR_APP_MARKER, createSsrRenderContext({ method: 'GET', url: '/', headers: {} }), { appHtml: '<main>Consumer</main>' });
log.level = 'debug';
log.debug({ example: true }, 'Consumer logger');

void [config, field, driver, job, appOptions, response, ai, textResult, log, document];
`, 'utf8');

	await writeFile(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
		compilerOptions: {
			target: 'ES2022',
			module: 'NodeNext',
			moduleResolution: 'NodeNext',
			strict: true,
			noEmit: true,
			skipLibCheck: false,
		},
		include: ['typecheck.ts'],
	}, null, '\t')}\n`, 'utf8');
}

/**
 * Expands a staged export map into runtime module specifiers for smoke testing.
 *
 * Non-code assets are omitted, while wildcard exports use a representative
 * concrete field module.
 *
 * @param {string} packageName - Installed package name.
 * @param {Record<string, unknown>} exportsMap - Staged package export map.
 * @returns {string[]} Importable public runtime specifiers.
 */
function publicRuntimeSpecifiers(packageName, exportsMap) {
	return Object.entries(exportsMap).flatMap(([subpath, target]) => {
		if (!target || typeof target !== 'object') return [];

		if (subpath === '.') return [packageName];

		return [`${packageName}${subpath.slice(1).replace('*', 'StringField')}`];
	});
}

/**
 * Executes a command and returns stdout, throwing with full diagnostics on failure.
 *
 * @param {string} command - Executable to run.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Working directory.
 * @param {NodeJS.ProcessEnv} [environment] - Optional process environment.
 * @returns {string} Captured standard output.
 */
function runCommand(command, args, cwd, environment = process.env) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: environment,
		stdio: 'pipe',
	});

	if (result.status !== 0) {
		throw new Error([
			`Command failed: ${command} ${args.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}

	return result.stdout;
}
