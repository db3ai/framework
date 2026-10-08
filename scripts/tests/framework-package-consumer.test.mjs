import assert from 'node:assert/strict';
import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

/** Verifies source consumers use the same package identities as installed tarballs. */
test('workspace framework identities match their public package names', () => {
	assert.equal(SOURCE_APP_MANIFEST.name, PUBLIC_APP_PACKAGE);
	assert.equal(SOURCE_PURE_MANIFEST.name, PUBLIC_PURE_PACKAGE);
	assert.equal(SOURCE_APP_MANIFEST.dependencies[PUBLIC_PURE_PACKAGE], SOURCE_PURE_MANIFEST.version);
});

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
				fastify: SOURCE_APP_MANIFEST.peerDependencies.fastify,
				playwright: SOURCE_APP_MANIFEST.peerDependencies.playwright,
				pinia: SOURCE_APP_MANIFEST.devDependencies.pinia,
				vue: SOURCE_APP_MANIFEST.devDependencies.vue,
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
		const runtimeOutput = runCommand(process.execPath, ['runtime.mjs'], consumerRoot);
		assert.match(runtimeOutput, /\[app\] Packed pretty transport ready/);
		runCommand(process.execPath, [TYPESCRIPT_CLI, '-p', 'tsconfig.json'], consumerRoot);
		runCommand(process.execPath, [TYPESCRIPT_CLI, '-p', 'tsconfig.browser.json'], consumerRoot);
		await verifyWebSocketRecipe(consumerRoot);

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

		assert.deepEqual(manifest.bin, {
			'db3-agents': 'bin/db3-agents.mjs',
			db3: 'bin/db3.mjs',
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
			network: ['runGuardedFetch.ts'],
			validation: ['validateNoteInput.ts', 'runNoteValidation.ts'],
			mail: ['welcomeMessage.ts', 'runMailPreview.ts'],
			auth: ['runPasswordAuth.ts'],
			queue: ['WriteReportJob.ts', 'runQueueReports.ts', 'runQueueWorkflows.ts', 'DeferredReportJob.ts', 'runBackpressure.ts', 'reportConsole.ts', 'outputs/queue-reports.json'],
			storage: ['runStorage.ts', 'writeCsvExport.ts', 'runStreamExport.ts'],
			media: ['runProjectMedia.ts', 'createPrivateFileServer.ts', 'runPrivateFiles.ts'],
			scheduler: ['WriteDailySummaryJob.ts', 'registerDailySummary.ts', 'runDailySummary.ts', 'RecoverableSummaryJob.ts', 'runScheduledReplay.ts', 'runSchedulerWindow.ts'],
			server: ['createFirstServer.ts', 'startFirstServer.ts'],
			websocket: ['userEndpoint.ts', 'resourceChannels.ts'],
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

		assert.doesNotMatch(content, /@platform\//, `${filePath} contains a retired workspace package scope.`);
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
	await access(join(appRoot, 'dist', 'ai', 'sdkNodeCompatibility.d.ts'), constants.R_OK);
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
import Fastify from 'fastify';
import { registerBrowserJsonFormatting } from '@db3.ai/app/server/browser-json';
import { registerHttpErrorHandler, publicServerErrorMessage } from '@db3.ai/app/server';
const previousErrorEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
const errorServer = Fastify();
registerHttpErrorHandler(errorServer);
errorServer.get('/failure', async () => { throw Object.assign(new Error('select private_column from private_table'), { code: 'ER_BAD_FIELD_ERROR' }); });
try {
	const response = await errorServer.inject('/failure');
	if (response.statusCode !== 500 || response.json().message !== 'Unexpected server error' || !response.json().reference || response.body.includes('private_column')) throw new Error('Installed HTTP error protection failed.');
	if (publicServerErrorMessage(new Error('secret'), 'production') !== 'Unexpected server error') throw new Error('Installed error-message policy failed.');
} finally {
	await errorServer.close();
	if (previousErrorEnvironment === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = previousErrorEnvironment;
}
const formattingServer = Fastify();
registerBrowserJsonFormatting(formattingServer);
formattingServer.get('/json', async () => ({ nested: { value: 1 } }));
try {
	const browserJson = await formattingServer.inject({ url: '/json', headers: { 'sec-fetch-mode': 'navigate' } });
	if (browserJson.body !== JSON.stringify(browserJson.json(), null, 2)) throw new Error('Installed browser JSON formatting failed.');
} finally {
	await formattingServer.close();
}
import { storageContentsToBuffer, mimeTypeFromPath } from '@db3.ai/app/storage';
import { validateFlowValues, cloneFlowValue } from '@db3.ai/app/flows';
if (storageContentsToBuffer('consumer').toString() !== 'consumer' || mimeTypeFromPath('report.JSON') !== 'application/json') throw new Error('Installed storage helpers failed.');
const validatedValues = validateFlowValues({ name: 'Consumer' }, { name: { type: 'string', required: true } }, 'Input');
if (validatedValues.name !== 'Consumer' || cloneFlowValue(validatedValues) === validatedValues) throw new Error('Installed flow value helpers failed.');
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { RuntimeEventEmitter } from '@openai/agents-core';
import { normalizedKey } from '@db3.ai/pure';
import { Config } from '@db3.ai/app/config';
import { App } from '@db3.ai/app';
import { QueueWorker, parseQueueConsoleArgs, queueConsoleSelection } from '@db3.ai/app/queue';
const workerSelection = queueConsoleSelection(parseQueueConsoleArgs(['queue:work', '--queues=*', '--exclude-queues=articles,article-images']));
if (workerSelection.queues !== '*' || workerSelection.excludeQueues.join(',') !== 'articles,article-images') throw new Error('Installed queue selection failed.');
const selectionConnection = knex({ client: 'mysql2' });
const selectionApp = new App({ db: selectionConnection, queue: { workerEnabled: false, queueMonitor: false } });
try {
	const protectedWorker = new QueueWorker(selectionApp.queue, workerSelection);
	await protectedWorker.stopAndDrain();
	if (await protectedWorker.workOnce() !== null) throw new Error('Stopped installed worker claimed work.');
} finally { await selectionApp.close(); await selectionConnection.destroy(); }
import { SchedulerWorker, ScheduledCall, SchedulerCheckpointRecord } from '@db3.ai/app/scheduler';
if (typeof SchedulerCheckpointRecord.checkpoint('consumer').load !== 'function') throw new Error('Installed scheduler persistence is missing.');
const minuteSchedule = new ScheduledCall(() => {}).name('consumer-minute').everyMinute();
if (minuteSchedule.definition().frequency.type !== 'minute' || !minuteSchedule.isDue(new Date('2026-09-25T13:45:00Z'))) throw new Error('Installed every-minute schedule failed.');
if (typeof SchedulerWorker !== 'function') throw new Error('Installed scheduler worker export is missing.');
import { Auth, PasswordLoginAttempt, PasswordSuspendedError } from '@db3.ai/app/auth';
import { newGuardedBrowserContext } from '@db3.ai/app/network/playwright';
if (PasswordLoginAttempt.identityKey(' Example@Email.test ') !== PasswordLoginAttempt.identityKey('example@email.test')) throw new Error('Password identity normalization export failed.');
if (!(new PasswordSuspendedError() instanceof Error) || typeof newGuardedBrowserContext !== 'function') throw new Error('Security public exports failed.');
const suspended = new PasswordSuspendedError({ attemptId: 'example-attempt', suspensionId: 'example-occurrence' });
if (suspended.suspension?.suspensionId !== 'example-occurrence' || new PasswordSuspendedError().suspension !== null) throw new Error('Password suspension transition export failed.');
import { InApp, InAppRecord, InAppError } from '@db3.ai/app/in-app';
import { Notifications } from '@db3.ai/app/notifications';
import { defineChannel, defineWebSocket } from '@db3.ai/app/websocket';
import { WebSocketClient } from '@db3.ai/app/websocket/client';
const pushApp = new App({ webSockets: { publish: { url: 'http://127.0.0.1:8001/_internal/realtime/publish', token: 'a'.repeat(64) } } });
await pushApp.close();
const socketClient = new WebSocketClient({ url: 'ws://localhost/ws/me', token: () => null });
if (defineChannel('website:{id}:jobs', { authorize: () => false }).pattern !== 'website:{id}:jobs') throw new Error('Channel definition export failed.');
const cleanup = socketClient.channel('website:example:jobs').on('completed', () => {});
cleanup();
if (socketClient.state !== 'closed' || typeof defineWebSocket({}).open !== 'undefined') throw new Error('WebSocket public exports failed.');
const inboxService = new InApp();
if ((await inboxService.send([], { title: 'Ready', body: 'Report ready' }, { scope: { type: 'account' }, type: 'report.ready' })).length !== 0) throw new Error('Empty inbox dispatch failed.');
if (InAppRecord.table !== 'in_app_messages' || new InAppError('invalid', 'test').code !== 'invalid') throw new Error('In-app exports failed.');
if (typeof Notifications !== 'function') throw new Error('Notifications public export failed.');
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import knex from 'knex';
import { Cli, listDb3Commands } from '@db3.ai/app/cli';
import { validate } from '@db3.ai/app/validation';
import { Log, PinoLoggerDriver } from '@db3.ai/app/logging';
import { Mail, ResendTransport } from '@db3.ai/app/mail';
import { createSsrRenderContext, renderSsrDocument, SSR_APP_MARKER, SSR_STATE_MARKER } from '@db3.ai/app/ssr';

import { ActiveRecord, mariaDbDialect, rememberDatabaseDialect } from '@db3.ai/app/db';
if (ActiveRecord.getScopedDb() !== undefined) throw new Error('Unexpected database scope.');
import { AIProviderDeferredError, AIProviderStoppedError, AIRequestTrackingError, Agent, calculateAIRequestCostUSD, calculateAIImageRequestCostUSD, chunkEmbeddingText } from '@db3.ai/app/ai';
const admissionDeferral = new AIProviderDeferredError(new Date(), new Date(), 'server_error', { status: 503, requestId: 'req_consumer' });
const streamStop = new AIProviderStoppedError('outage', admissionDeferral.providerCode, { ...admissionDeferral.diagnostics, stopStage: 'stream-output' });
if (streamStop.stopStage !== 'stream-output' || streamStop.status !== 503 || streamStop.requestId !== 'req_consumer' || streamStop.message.includes('deadline')) throw new Error('Installed provider stop diagnostics failed.');
const passages = chunkEmbeddingText('Unicode 🪵 text '.repeat(1000), { context: 'Page title', maxTokens: 256 });
if (passages.length < 2 || passages.some(chunk => chunk.tokens > 256)) throw new Error('Installed embedding chunk preparation failed.');
const trackingFailure = new AIRequestTrackingError({ code: 'ER_LOCK_WAIT_TIMEOUT', message: 'private SQL binding' });
if (trackingFailure.code !== 'ER_LOCK_WAIT_TIMEOUT' || trackingFailure.message.includes('private')) throw new Error('Installed tracking error export failed.');

/** Verifies installed agents accept an explicit unlimited turn setting. */
class UnlimitedAgent extends Agent {
	maxTurns = null;
	/** Supplies a minimal consumer-owned task. */
	async instructions() { return 'Answer the user.'; }
	/** Keeps the smoke-test agent independent of application tools. */
	tools() { return []; }
}
if (new UnlimitedAgent({}).maxTurns !== null) throw new Error('Installed agent turn configuration failed.');

if (calculateAIRequestCostUSD('gpt-6-astra', { inputTokens: 200, cachedTokens: 60, cacheWriteTokens: 40, outputTokens: 30 }) !== 0.00306) throw new Error('Installed Astra pricing failed.');
if (calculateAIRequestCostUSD('gpt-6-sol', { inputTokens: 200, cachedTokens: 60, cacheWriteTokens: 40, outputTokens: 30 }) !== 0.000612) throw new Error('Installed GPT-6 Sol pricing failed.');
if (calculateAIRequestCostUSD('gpt-6-luna', { inputTokens: 200, cachedTokens: 60, cacheWriteTokens: 40, outputTokens: 30 }) !== 0.0000306) throw new Error('Installed GPT-6 Luna pricing failed.');
if (calculateAIRequestCostUSD('gpt-5.6-sol', { inputTokens: 200, cachedTokens: 60, cacheWriteTokens: 40, outputTokens: 30 }) !== 0.001224) throw new Error('Installed Sol pricing failed.');
if (calculateAIImageRequestCostUSD('gpt-image-2.5-flare', { inputTextTokens: 20, inputImageTokens: 0, outputImageTokens: 1000 }) !== 0.0301) throw new Error('Installed Flare pricing failed.');

/** An installed-package model using inferred field definitions. */
class DefinedUser extends ActiveRecord.define({
	table: 'consumer_users',
	fields: field => ({ id: field.ulid(), email: field.email({ required: true }) }),
}) {
	/** Returns a domain from the field's normalized application value. */
	domain() { return this.email?.split('@')[1]; }
	/** Retains custom static behavior through further definitions. */
	static kind() { return 'user'; }
}
/** An ordinary subclass that must survive inherited creation and hydration. */
class Admin extends DefinedUser {
	/** Identifies an administrator instance. */
	isAdmin() { return true; }
}
/** A composed definition adds a field without losing the inherited methods. */
class Staff extends Admin.define({ fields: field => ({ team: field.string() }) }) {}
const staff = new Staff({ email: ' ADMIN@EXAMPLE.COM ', team: ' Team ' });
if (staff.email !== 'admin@example.com' || staff.domain() !== 'example.com' || !staff.isAdmin()) throw new Error('Defined record runtime inheritance failed.');
if (Staff.kind() !== 'user' || staff.team !== 'Team' || staff.isPersisted()) throw new Error('Defined record metadata or lifecycle failed.');
if (Staff.fromDb({ email: 'admin@example.com' }).domain() !== 'example.com') throw new Error('Defined record hydration failed.');
const boundEmail = staff.getBoundField('email');
staff.email = 'NEXT@EXAMPLE.COM';
if (boundEmail.value !== 'next@example.com' || boundEmail === Staff.getField('email')) throw new Error('Defined record field ownership failed.');

// Lazy database services must retain the default app root after a working-directory change.
const directory = process.cwd();
const migrationConnection = knex({ client: 'mysql2' });
rememberDatabaseDialect(migrationConnection, mariaDbDialect);
if (!DefinedUser.query(migrationConnection).forUpdate().toKnex().toSQL().sql.endsWith('for update')) throw new Error('Typed row lock export failed.');
const application = new App({ db: migrationConnection, dbOptions: { migrations: { models: [DefinedUser], environment: 'test' } } });
try {
	process.chdir('node_modules');
	const migration = await application.db.migrations.makeMigration({ name: 'consumer' });
	if (!migration.generated || dirname(migration.file) !== join(directory, 'server/database/migrations')) throw new Error('Conventional migration directory failed.');
	const snapshot = JSON.parse(await readFile(join(directory, 'server/database/schema.snapshot.json'), 'utf8'));
	if (!snapshot.tables.some(table => table.name === 'consumer_users')) throw new Error('Conventional migration snapshot failed.');
} finally { process.chdir(directory); await application.close(); await migrationConnection.destroy(); }

const require = createRequire(import.meta.url);
if (typeof Auth.prototype.revokeAllTokens !== 'function') throw new Error('Installed auth session revocation export failed.');
const originalFetch = globalThis.fetch;
let mailRequest;
globalThis.fetch = async (_url, init) => { mailRequest = init; return Response.json({ id: 'consumer-mail' }); };
try {
	await new Mail({ transport: new ResendTransport({ apiKey: 'synthetic-consumer-key' }) }).send({ to: 'consumer@example.test', subject: 'Ready', text: 'Ready', idempotencyKey: 'consumer/setup' });
	if (mailRequest.headers['Idempotency-Key'] !== 'consumer/setup') throw new Error('Installed mail retry identity failed.');
} finally { globalThis.fetch = originalFetch; }
if (!(await listDb3Commands()).some(command => command.name === 'queue:make-job')) throw new Error('Installed command discovery failed.');
if (await new Cli({ commands: [{ name: 'consumer:check', description: 'Check the installed runner.', run: () => 3 }] }).run(['consumer:check']) !== 3) throw new Error('Installed CLI runtime failed.');
if (RuntimeEventEmitter !== EventEmitter) throw new Error('SDK compatibility declarations must not replace the runtime emitter.');
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
const errorEmails = [];
const emailApp = new App({ log: { level: 'error', console: false, devtools: false, transports: [{ type: 'email', ...{ to: 'operator@example.test' } }] } });
emailApp.set('mail', new Mail({ transport: { async send(message) { errorEmails.push(message); return { id: 'email', transport: 'test', accepted: ['operator@example.test'], rejected: [] }; } } }));
emailApp.log.child({ requestId: 'packed-request' }).error({ err: new Error('Packed exception') }, 'Packed failure');
await emailApp.close();
if (errorEmails.length !== 1 || !errorEmails[0].text.includes('Packed exception') || !errorEmails[0].text.includes('packed-request')) throw new Error('Packed error email transport failed.');
const prettyLog = new Log({ level: 'info', devtools: false, consoleFormat: 'pretty', source: 'packed-logger' });
prettyLog.info('Packed pretty transport ready');
await prettyLog.close();
if (!require.resolve('@db3.ai/app/agent-instructions').endsWith('agent-instructions.md')) {
	throw new Error('Agent instructions export failed.');
}

for (const specifier of ${JSON.stringify(runtimeSpecifiers)}) {
	await import(specifier);
}
`, 'utf8');

	await writeFile(join(consumerRoot, 'typecheck.ts'), `
import { Auth, UserIdentity, PasswordLoginAttempt, PasswordSuspendedError, type PasswordAuthProviderOptions, type PasswordSuspensionOptions, type PasswordSuspension } from '@db3.ai/app/auth';
import { newGuardedBrowserContext, type GuardedBrowserContextOptions } from '@db3.ai/app/network/playwright';
const suspension: PasswordSuspensionOptions = { maxFailedAttempts: 20 };
const passwordOptions: PasswordAuthProviderOptions = { identityModel: UserIdentity, suspension };
const browserOptions: GuardedBrowserContextOptions = { requestTimeoutMs: 30000, onBlocked({ url, error }) { const blocked: Error = error; void [url, blocked]; } };
const attempt: PasswordLoginAttempt = PasswordLoginAttempt.create({ identityHash: PasswordLoginAttempt.identityKey('example@email.test') });
const readableIdentity: string | null = attempt.identity;
const occurrence: PasswordSuspension | null = new PasswordSuspendedError().suspension;
void [readableIdentity, occurrence];
void [passwordOptions, browserOptions, attempt, PasswordSuspendedError, newGuardedBrowserContext];
import { storageContentsToBuffer, mimeTypeFromPath } from '@db3.ai/app/storage';
import { validateFlowValues, cloneFlowValue, type FlowValue, type FlowValues } from '@db3.ai/app/flows';
const storageBytes: Buffer = storageContentsToBuffer(new Uint8Array([1, 2]));
const storageMime: string = mimeTypeFromPath('report.json');
const flowValues: FlowValues = validateFlowValues({ name: 'Consumer' }, { name: { type: 'string' } }, 'Input');
const clonedValues: FlowValue = cloneFlowValue(flowValues);
void [storageBytes, storageMime, clonedValues];
const lockedUser: Promise<UserIdentity | null> = UserIdentity.where('id', 'example').forUpdate().first();
void lockedUser;
import { Config } from '@db3.ai/app/config';
import { Cli, defineCommand, listDb3Commands, runRepl, type CliCommandInfo, type ReplOptions, type CliConfig, type CliCommand } from '@db3.ai/app/cli';
import { databaseCommands } from '@db3.ai/app/db/commands';
import { StringField } from '@db3.ai/app/db/fields/StringField';
import type { FieldConfig } from '@db3.ai/app/db/FieldType';
import { QueueWorker, type Queue, type QueueDriver, type QueueJob, type QueueSelection } from '@db3.ai/app/queue';
const protectedSelection: QueueSelection = { queues: '*', excludeQueues: ['articles', 'article-images'] };
declare const consumingQueue: Queue;
const selectedWorker = consumingQueue.startWorker(protectedSelection, { maxJobsPerTick: 1 });
const boundedWorker = new QueueWorker(consumingQueue, { queues: ['default', 'articles'] });
const boundedResult = boundedWorker.workOnce();
void [selectedWorker, boundedResult];
import { registerBrowserJsonFormatting } from '@db3.ai/app/server/browser-json';
import { registerHttpErrorHandler, publicServerErrorMessage, type AppOptions, type HttpErrorHandlerOptions, type HttpServerErrorContext } from '@db3.ai/app/server';
import Fastify from 'fastify';
const httpErrorOptions: HttpErrorHandlerOptions = {
	mapError: () => ({ statusCode: 422, body: { error: 'invalid_request', message: 'Check the request.' } }),
	onServerError: (error: unknown, context: HttpServerErrorContext) => { const reference: string = context.reference; void [error, reference]; },
};
registerHttpErrorHandler(Fastify(), httpErrorOptions);
registerBrowserJsonFormatting(Fastify());
const safeErrorMessage: string = publicServerErrorMessage(new Error('secret'), 'production');
void safeErrorMessage;
import type { TextResponsePayload } from '@db3.ai/pure/ai';
import { Ai, AIProviderDeferredError, AIProviderStoppedError, AIRequestTrackingError, Agent, AiConversation, AiMessage, AiRequest, agentToolContext, emitAgentToolProgress, type AgentToolProgressInput, type AIServiceTier } from '@db3.ai/app/ai';
const typedDeferral = new AIProviderDeferredError(new Date(), new Date(), 'server_error', { status: 503, requestId: 'req_consumer' });
const typedStop = new AIProviderStoppedError('outage', typedDeferral.providerCode, { ...typedDeferral.diagnostics, stopStage: 'stream-output' });
const stopStage: 'quota' | 'deadline' | 'stream-output' = typedStop.stopStage;
void stopStage;
import { chunkEmbeddingText, type EmbeddingTextChunk, type GenerateTextResult } from '@db3.ai/app/ai';
const preparedChunks: EmbeddingTextChunk[] = chunkEmbeddingText('A document', { context: 'Title', maxTokens: 8000 });
void preparedChunks;
const trackingFailure: AIRequestTrackingError = new AIRequestTrackingError({ code: 'ER_LOCK_WAIT_TIMEOUT' });
void trackingFailure;
import type { MailMessage } from '@db3.ai/app/mail';
const errorEmailOptions: AppOptions = { log: { transports: [{ type: 'email', ...{ to: 'operator@example.test', subjectPrefix: 'Consumer error' } }] } };
void errorEmailOptions;
import { InApp, type InAppAcceptance, type InAppMessage, type InAppInboxPage } from '@db3.ai/app/in-app';
import type { InAppScope } from '@db3.ai/app/in-app/contracts';
import type { Notification, NotificationDelivery } from '@db3.ai/app/notifications';
import { defineChannel, defineWebSocket, type WebSocketContext, type WebSocketPresence } from '@db3.ai/app/websocket';
import { WebSocket as NodeWebSocket } from 'ws';
import { registerWebSockets } from '@db3.ai/app/websocket/fastify';
import { WebSocketClient } from '@db3.ai/app/websocket/client';
const realtimeOptions: AppOptions = { webSockets: { publish: { url: 'http://127.0.0.1:8001/_internal/realtime/publish', token: 'a'.repeat(64) } } };
void realtimeOptions;
const socketEndpoint = defineWebSocket({ parse: (data: unknown) => String(data), async message(context, data) { const value: string = data; const typed: WebSocketContext = context; await typed.send(value); } });
const socketClient = new WebSocketClient({ url: 'ws://localhost/ws/me', token: () => null, onMessage(data: unknown) { void data; } });
const channelEndpoint = defineWebSocket({ channels: [defineChannel('website:{websiteId}:jobs', { authorize: ({ userId, params }) => Boolean(userId && params.websiteId) })] });
const cleanupChannel = socketClient.channel('website:example:jobs').on('completed', (data: unknown) => { void data; });
cleanupChannel();
void channelEndpoint;
const presence: WebSocketPresence[] = [];
const publicEndpoint = defineWebSocket({ auth: 'public', async open(context) { const user: null = context.user; const userId: null = context.userId; await context.send({ user, userId }); } });
const publicClient = new WebSocketClient({ url: 'ws://localhost/ws/public', auth: 'public', onMessage() {} });
const cookieClient = new WebSocketClient({ url: 'ws://localhost/ws/me', auth: 'cookie', onMessage() {} });
const nodeClient = new WebSocketClient({ url: 'ws://localhost/ws/public', auth: 'public', createSocket: url => new NodeWebSocket(url, { origin: 'http://localhost' }), onMessage() {} });
void nodeClient;
void [publicEndpoint, publicClient, cookieClient];
void [registerWebSockets, socketEndpoint, socketClient, presence];
const scope: InAppScope = { type: 'account' };
const inAppMessage: InAppMessage = { title: 'Ready', body: 'Report ready', presentation: 'banner' };
const inApp = new InApp({ onChanged: async (userId: string) => { void userId; }, onDeliveryError: (error: unknown) => { void error; } });
const acceptances: Promise<InAppAcceptance[]> = inApp.send([], inAppMessage, { scope, type: 'report.ready' });
const page: Promise<InAppInboxPage> = inApp.inbox({ scope });
void [acceptances, page];
const notification: Notification = { type: 'report.ready', via: () => ['inApp', 'mail'], toInApp: () => inAppMessage, toMail: () => ({ to: 'owner@example.test', subject: 'Ready', text: 'Ready' }) };
const alertLoggerOptions: import('@db3.ai/app/logging').LoggingOptions = { file: '/tmp/consumer.log', console: false, consoleFormat: 'pretty' };
import { ScheduledCall, type ScheduleFrequency, SchedulerWorker, SchedulerCheckpointRecord, type SchedulerCheckpoint, type SchedulerConsoleOptions } from '@db3.ai/app/scheduler';
const minuteFrequency: ScheduleFrequency = new ScheduledCall(() => {}).name('consumer-minute').everyMinute().definition().frequency;
void minuteFrequency;
const databaseCheckpoint: SchedulerCheckpoint = SchedulerCheckpointRecord.checkpoint('consumer');
void databaseCheckpoint;
const checkpoint: SchedulerCheckpoint = { load: async firstMinute => new Date(firstMinute.getTime() - 60000), save: async evaluatedFor => { const minute: Date = evaluatedFor; void minute; } };
const tickOptions: import('@db3.ai/app/scheduler').SchedulerWorkerOptions = { checkpoint, onTick: async result => { const minute: Date = result.evaluatedFor; void minute; } };
const consoleCheckpoint: SchedulerConsoleOptions['checkpoint'] = checkpoint;
void [SchedulerWorker, consoleCheckpoint];
const delivery = null as NotificationDelivery | null;
void [notification, delivery];
import { calculateAIRequestCostUSD, calculateAIImageRequestCostUSD, type AIRequestCostUsage, type AIImageRequestCostUsage } from '@db3.ai/app/ai';
import { Agent as SdkAgent, RuntimeEventEmitter, RunContext } from '@openai/agents-core';
import { Log, type Logger } from '@db3.ai/app/logging';
import { createSsrRenderContext, renderSsrDocument, SSR_APP_MARKER } from '@db3.ai/app/ssr';

const config = new Config({ app: { name: 'Consumer' } } as const);
/** Verifies the published declaration allows applications to remove the turn ceiling. */
class UnlimitedAgent extends Agent {
	protected override readonly maxTurns = null;
	/** Supplies a minimal consumer-owned task. */
	async instructions(): Promise<string> { return 'Answer the user.'; }
	/** Keeps the type-check agent independent of application tools. */
	protected tools() { return []; }
}
const unlimitedAgent: Agent = new UnlimitedAgent({});
void unlimitedAgent;
const revokeAllTokens: (user: UserIdentity) => Promise<number> = Auth.prototype.revokeAllTokens;
void revokeAllTokens;
const completionMessage: MailMessage = { to: 'consumer@example.test', subject: 'Ready', text: 'Ready', idempotencyKey: 'consumer/setup' };
void completionMessage;
const customCommand: CliCommand = { name: 'consumer:check', description: 'Typed command.', arguments: [{ name: 'name', required: true }], async run(context) { const name: string | undefined = context.args[0]; context.write(name ?? ''); return 0; } };
const commandCatalog: Promise<CliCommandInfo[]> = listDb3Commands();
void commandCatalog;
const cliConfig: CliConfig = { commands: [customCommand] };
const cliStatus: Promise<number> = new Cli(cliConfig).run(['consumer:check', 'example']);
const replOptions: ReplOptions = { values: { answer: 42 }, input: process.stdin, output: process.stdout };
const replRunner: (options: ReplOptions) => Promise<void> = runRepl;
void [replOptions, replRunner];
const configuredMigrations: CliCommand[] = databaseCommands;
const namedCommand = defineCommand({ name: 'example:action', description: 'Named arguments.', parameters: [{ name: 'name' }], handle: parameters => ({ name: parameters.name }), exitCode: result => result.name ? 0 : 1 });
const migrationOptions: AppOptions = { directory: new URL('./', import.meta.url), dbOptions: { migrations: { models: [] } } };
// @ts-expect-error App migration paths follow the server/database convention.
const customMigrationPaths: AppOptions = { dbOptions: { migrations: { models: [], migrationsDirectory: '/custom' } } };
void [cliStatus, configuredMigrations, namedCommand, migrationOptions];
const fieldConfig: FieldConfig = { required: true };
const field = new StringField(fieldConfig);
const driver = null as QueueDriver | null;
const job = null as QueueJob | null;
const appOptions = {} as AppOptions;
const response: TextResponsePayload = { output_text: 'ok' };
const ai = new Ai({ apiKey: 'test-only-not-used', model: 'test' });
const serviceTier: AIServiceTier = 'flex';
abstract class FlexConsumerAgent extends Agent {
	protected override readonly serviceTier: AIServiceTier = serviceTier;
	/** Supplies the consumer agent instruction. */
	async instructions(): Promise<string> { return 'Answer.'; }
}
void FlexConsumerAgent;
const astraUsage: AIRequestCostUsage = { serviceTier, inputTokens: 200, cachedTokens: 60, cacheWriteTokens: 40, outputTokens: 30 };
const astraCost: number | null = calculateAIRequestCostUSD('gpt-6-astra', astraUsage);
const solCost: number | null = calculateAIRequestCostUSD('gpt-6-sol', astraUsage);
const lunaCost: number | null = calculateAIRequestCostUSD('gpt-6-luna', astraUsage);
void [astraCost, solCost, lunaCost];
const flareUsage: AIImageRequestCostUsage = { inputTextTokens: 20, inputImageTokens: 0, outputImageTokens: 1000 };
const flareCost: number | null = calculateAIImageRequestCostUSD('gpt-image-2.5-flare', flareUsage);
void flareCost;
const textResult = null as GenerateTextResult | null;
const toolContext = new RunContext({ projectId: 'project-1', emitToolProgress(_progress: AgentToolProgressInput) {} });
const projectId: string | undefined = agentToolContext(toolContext)?.projectId;
void emitAgentToolProgress({ runContext: toolContext, details: undefined, toolName: 'index', message: 'Indexed' });
void projectId;
const sdkAgent = new SdkAgent({ name: 'Consumer type check' });
sdkAgent.on('agent_start', (_context, runningAgent, input) => {
	const name: string = runningAgent.name;
	void [name, input];
});
// @ts-expect-error SDK lifecycle event names remain checked.
sdkAgent.on('unknown_event', () => {});
const emitter = new RuntimeEventEmitter<{ progress: [number] }>();
emitter.on('progress', value => { const progress: number = value; void progress; }).setMaxListeners(20);
emitter.emit('progress', 1);
// @ts-expect-error SDK emitter payload tuples remain checked.
emitter.emit('progress', 'invalid');
// @ts-expect-error SDK emitter listener parameters remain checked.
emitter.on('progress', (value: string) => {});
const log: Logger = new Log({ level: 'silent', devtools: false });
const document = renderSsrDocument(SSR_APP_MARKER, createSsrRenderContext({ method: 'GET', url: '/', headers: {} }), { appHtml: '<main>Consumer</main>' });
log.level = 'debug';
log.debug({ example: true }, 'Consumer logger');

void [config, field, driver, job, appOptions, response, ai, textResult, log, document];
`, 'utf8');

	// Compile the DB-owned inference contract against installed declarations.
	const defineTypesPath = join(REPOSITORY_ROOT, 'packages/app/src/db/tests/types/active-record-define.ts');
	const defineTypes = await readFile(defineTypesPath, 'utf8');
	await writeFile(join(consumerRoot, 'active-record-define.ts'), defineTypes, 'utf8');

	// Browser declarations must work without automatically including Node types.
	await writeFile(join(consumerRoot, 'browser.ts'), `
import { WebSocketClient, type WebSocketClientState } from '@db3.ai/app/websocket/client';
let state: WebSocketClientState = 'closed';
const client = new WebSocketClient({ url: 'wss://example.test/ws/me', token: () => null, onMessage(data: unknown) { void data; }, onState(value) { state = value; } });
client.close();
void state;
`, 'utf8');
	await writeFile(join(consumerRoot, 'tsconfig.browser.json'), JSON.stringify({
		compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false, lib: ['ES2022', 'DOM'], types: [] },
		include: ['browser.ts'],
	}), 'utf8');

	await writeFile(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
		compilerOptions: {
			target: 'ES2022',
			module: 'NodeNext',
			moduleResolution: 'NodeNext',
			strict: true,
			noEmit: true,
			skipLibCheck: false,
		},
		include: ['typecheck.ts', 'active-record-define.ts'],
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


/** Compiles and runs the shipped Pinia recipe against installed exports, without workspace source aliases. */
async function verifyWebSocketRecipe(consumerRoot) {
	await cp(join(consumerRoot, 'node_modules', '@db3.ai', 'app', 'src', 'websocket', 'examples'), join(consumerRoot, 'live-examples'), { recursive: true });
	await writeFile(join(consumerRoot, 'tsconfig.live.json'), JSON.stringify({
		compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: true, noEmit: true, lib: ['ES2022', 'DOM'], types: ['node'] },
		include: ['live-examples/**/*.ts'],
	}));
	runCommand(process.execPath, [TYPESCRIPT_CLI, '-p', 'tsconfig.live.json'], consumerRoot);
	await writeFile(join(consumerRoot, 'live-recipe.mjs'), `
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createBoardStore } from './live-examples/board/createBoardStore.ts';
import { createChannelSync } from './live-examples/createChannelSync.ts';
import { SummarizeBoardJob } from './live-examples/board/SummarizeBoardJob.ts';
import { readDeploymentSnapshot } from './live-examples/deploymentSnapshot.ts';
import { deploymentEndpoint } from './live-examples/deploymentEndpoint.ts';
const deployment = readDeploymentSnapshot({ id: 'deploy-1', environmentId: 'production', revision: 2, releaseId: 'new', activeReleaseId: 'new', phase: 'live', health: 'passed', message: 'Serving traffic' }, { id: 'deploy-1', environmentId: 'production' }, null);
assert.equal(deployment.phase, 'live');
assert.ok(deploymentEndpoint(() => true));
const snapshot = { id: 'board-1', revision: 1, cards: [], activity: { id: 'c7c15678-8362-4d25-9fc1-df5dce2578ae', status: 'running', result: null } };
const store = createBoardStore('board-1', { read: async () => snapshot })(createPinia());
const sync = createChannelSync({ url: 'ws://localhost/ws', token: () => null });
try {
 const binding = sync.watch('board:board-1', async () => snapshot, store.apply, store.fail);
 await binding.refresh();
 assert.equal(store.busy, true);
 store.apply({ ...snapshot, revision: 2, activity: { ...snapshot.activity, status: 'completed', result: 'Done' } });
 assert.equal(store.busy, false);
 assert.equal(new SummarizeBoardJob({ boardId: 'board-1', userId: 'user-1', runId: snapshot.activity.id }).serialize().job, 'boards.summarize.v1');
} finally { sync.close(); store.$dispose(); }
`);
	runCommand(process.execPath, ['--import', 'tsx', 'live-recipe.mjs'], consumerRoot);
}
