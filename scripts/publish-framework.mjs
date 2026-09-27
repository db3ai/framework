#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAMEWORK_RELEASE_PACKAGES, assertPackageInspection, isFrameworkReleaseVersion } from './lib/framework-release-policy.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Parses the explicitly selected release version and optional npm dry-run.
 *
 * @param {string[]} args - Arguments passed after `npm run framework:publish --`.
 * @returns {{ version: string, tag: string, dryRun: boolean, from: string }} Publication options.
 */
export function parsePublishArguments(args) {
	let version;
	let tag;
	let dryRun = false;
	let from = 'pure';
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--dry-run') {
			dryRun = true;
		} else if (argument === '--version' || argument === '--tag' || argument === '--from') {
			const value = args[++index];
			if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
			if (argument === '--version') version = value;
			else if (argument === '--tag') tag = value;
			else from = value;
		} else {
			throw new Error(`Unknown publication option: ${argument}`);
		}
	}
	if (!isFrameworkReleaseVersion(version)) throw new Error('Specify a release version, for example: npm run framework:publish -- --version 0.1.0-beta.1');
	tag ??= version.includes('-') ? 'next' : 'latest';
	if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new Error('--tag must be an npm channel name such as next or latest.');
	if (version.includes('-') && tag === 'latest') throw new Error('Publish prereleases under next or another prerelease tag.');
	if (!FRAMEWORK_RELEASE_PACKAGES.some(definition => definition.directory === from)) throw new Error('--from must be pure, app or create.');
	return { version, tag, dryRun, from };
}

/**
 * Builds the current framework source and lets npm publish the package folders.
 *
 * Only disposable package manifests receive the requested version; workspace
 * versions and local app dependency links remain intact. All package inspections
 * finish before the first publication. npm handles authentication interactively.
 *
 * @param {{ version: string, tag: string, dryRun: boolean, from: string }} options - Explicit release identity, mode and resume point.
 * @returns {Promise<void>}
 */
export async function publishFramework(options) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'db3-framework-publish-'));
	try {
		const sourceManifest = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'packages/app/package.json'), 'utf8'));
		console.log(`Building DB3 ${options.version} for npm tag ${options.tag}${options.dryRun ? ' (dry-run)' : ''}.`);
		runCommand(process.execPath, [join(REPOSITORY_ROOT, 'scripts/stage-framework-packages.mjs'), '--output', outputRoot, '--repository-url', sourceManifest.repository.url], REPOSITORY_ROOT);
		await setPublicationVersion(outputRoot, options.version);
		publishPackageDirectories(outputRoot, options);
		console.log(options.dryRun ? 'Selected npm publication dry-runs passed. Nothing was published.' : `Published the selected DB3 ${options.version} packages under ${options.tag}.`);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
}

/**
 * Applies a lockstep version to compiled packages and their generated app.
 *
 * @param {string} outputRoot - Disposable directory produced by package staging.
 * @param {string} version - Validated release version selected by the maintainer.
 * @returns {Promise<void>}
 */
export async function setPublicationVersion(outputRoot, version) {
	for (const definition of FRAMEWORK_RELEASE_PACKAGES) {
		const path = join(outputRoot, definition.directory, 'package.json');
		const manifest = JSON.parse(await readFile(path, 'utf8'));
		if (manifest.name !== definition.name) throw new Error(`Unexpected package identity in ${path}.`);
		manifest.version = version;
		if (definition.directory === 'app') manifest.dependencies['@db3.ai/pure'] = version;
		await writeFile(path, `${JSON.stringify(manifest, null, '\t')}\n`);
	}
	const templatePath = join(outputRoot, 'create/template/package.json');
	const template = JSON.parse(await readFile(templatePath, 'utf8'));
	template.dependencies['@db3.ai/app'] = version;
	await writeFile(templatePath, `${JSON.stringify(template, null, '\t')}\n`);
}

/**
 * Inspects every package, then publishes in dependency order, stopping on failure.
 *
 * The command runner is the external npm process boundary. Dry-run is forwarded
 * to every npm publish invocation and package lifecycle scripts are disabled.
 *
 * @param {string} outputRoot - Directory containing the three compiled packages.
 * @param {{ version: string, tag: string, dryRun: boolean, from?: string }} options - Release identity, mode and optional resume point after a partial release.
 * @param {typeof runCommand} command - External process runner.
 * @returns {void}
 */
export function publishPackageDirectories(outputRoot, options, command = runCommand) {
	const startIndex = FRAMEWORK_RELEASE_PACKAGES.findIndex(definition => definition.directory === (options.from ?? 'pure'));
	if (startIndex < 0) throw new Error('Unknown package resume point.');
	for (const definition of FRAMEWORK_RELEASE_PACKAGES) {
		const output = command(NPM_COMMAND, ['pack', '--dry-run', '--ignore-scripts', '--json'], join(outputRoot, definition.directory), true);
		const inspections = JSON.parse(output);
		if (!Array.isArray(inspections) || inspections.length !== 1) throw new Error(`Expected one npm inspection for ${definition.name}.`);
		assertPackageInspection({ name: definition.name, version: options.version }, inspections[0]);
	}
	for (const definition of FRAMEWORK_RELEASE_PACKAGES.slice(startIndex)) {
		console.log(`${options.dryRun ? 'Dry-running' : 'Publishing'} ${definition.name}@${options.version}`);
		command(NPM_COMMAND, ['publish', '--access=public', `--tag=${options.tag}`, '--provenance=false', '--ignore-scripts', ...(options.dryRun ? ['--dry-run'] : [])], join(outputRoot, definition.directory));
	}
}

/**
 * Runs npm or the compiler, preserving interactive authentication and failures.
 *
 * @param {string} executable - Program to launch without a shell.
 * @param {string[]} args - Program arguments.
 * @param {string} cwd - Package or repository working directory.
 * @param {boolean} capture - Capture JSON inspection output when true.
 * @returns {string} Captured stdout, or an empty string for interactive commands.
 */
function runCommand(executable, args, cwd, capture = false) {
	const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${executable} ${args.join(' ')} failed in ${cwd}${result.stderr ? `\n${result.stderr}` : ''}`);
	return result.stdout ?? '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await publishFramework(parsePublishArguments(process.argv.slice(2)));
}
