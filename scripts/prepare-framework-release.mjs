#!/usr/bin/env node

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
	FRAMEWORK_RELEASE_PACKAGES,
	assertPackageInspection,
	collectReleaseArtifactIssues,
	collectSourceReleaseIssues,
	formatReleaseIssues,
	frameworkRepositoryUrl,
	frameworkReleaseTag,
	isFrameworkReleaseVersion,
	isGitHubRepository,
} from './lib/framework-release-policy.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STAGING_SCRIPT = join(REPOSITORY_ROOT, 'scripts', 'stage-framework-packages.mjs');
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const options = parseArguments(process.argv.slice(2));

await prepareFrameworkRelease(options);

/**
 * Parses release identity and artifact output options.
 *
 * @param {string[]} args - Command-line arguments after the executable name.
 * @returns {{ version: string, repository: string, outputRoot: string }} Validated options.
 */
function parseArguments(args) {
	let version = '';
	let repository = '';
	let output = '';

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		const value = args[index + 1];

		if (argument === '--version' || argument === '--repository' || argument === '--output') {
			if (!value) throw new Error(`${argument} requires a value.`);

			if (argument === '--version') version = value;
			if (argument === '--repository') repository = value;
			if (argument === '--output') output = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown framework release option "${argument}".`);
	}

	if (!isFrameworkReleaseVersion(version)) {
		throw new Error('--version must be a strict SemVer release without build metadata.');
	}

	if (!isGitHubRepository(repository)) {
		throw new Error('--repository must identify the dedicated public GitHub repository as owner/name.');
	}

	const outputRoot = output
		? resolve(process.cwd(), output)
		: join(REPOSITORY_ROOT, 'dist', 'framework-release', version);

	assertSafeOutputRoot(outputRoot);

	return { version, repository, outputRoot };
}

/**
 * Builds, inspects, and records a non-publishing framework release candidate.
 *
 * @param {{ version: string, repository: string, outputRoot: string }} release - Candidate identity and destination.
 * @returns {Promise<void>}
 */
async function prepareFrameworkRelease(release) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'db3-framework-release-'));
	const stagedRoot = join(temporaryRoot, 'staged');
	const npmEnvironment = {
		...process.env,
		npm_config_cache: join(temporaryRoot, 'npm-cache'),
	};

	try {
		const sourceIssues = collectSourceReleaseIssues(await readSourceMetadata(release));

		if (sourceIssues.length > 0) {
			throw new Error(formatReleaseIssues('Checked-in framework release metadata is not ready', sourceIssues));
		}

		runCommand(process.execPath, [
			STAGING_SCRIPT,
			'--output',
			stagedRoot,
			'--repository-url',
			frameworkRepositoryUrl(release.repository),
		], REPOSITORY_ROOT, npmEnvironment);

		const candidate = await readCandidateMetadata(release, stagedRoot);
		const issues = collectReleaseArtifactIssues(candidate);

		if (issues.length > 0) {
			throw new Error(formatReleaseIssues('Framework release candidate is not publishable', issues));
		}

		for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
			const inspection = inspectPackage(
				join(stagedRoot, packageDefinition.directory),
				npmEnvironment,
			);

			assertPackageInspection(
				{ name: packageDefinition.name, version: release.version },
				inspection,
			);
		}

		await rm(release.outputRoot, { recursive: true, force: true });
		await mkdir(release.outputRoot, { recursive: true });

		const packages = [];

		for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
			const packed = packPackage(
				join(stagedRoot, packageDefinition.directory),
				release.outputRoot,
				npmEnvironment,
			);

			packages.push({
				name: packed.name,
				version: packed.version,
				filename: packed.filename,
				shasum: packed.shasum,
				integrity: packed.integrity,
				fileCount: Array.isArray(packed.files) ? packed.files.length : null,
				unpackedSize: packed.unpackedSize,
			});
		}

		await writeFile(
			join(release.outputRoot, 'release-candidate.json'),
			`${JSON.stringify({
				schemaVersion: 1,
				repository: release.repository,
				tag: frameworkReleaseTag(release.version),
				version: release.version,
				packages,
			}, null, '\t')}\n`,
			'utf8',
		);

		console.log(`Prepared inspected framework candidate at ${release.outputRoot}. No package was published.`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

/**
 * Loads the reviewed workspace manifests that must already match the tag.
 *
 * @param {{ version: string, repository: string }} release - Requested release identity.
 * @returns {Promise<{ version: string, repository: string, packages: Record<string, Record<string, any>> }>} Checked-in source metadata.
 */
async function readSourceMetadata(release) {
	const packages = {};

	for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
		packages[packageDefinition.directory] = JSON.parse(await readFile(
			join(REPOSITORY_ROOT, 'packages', packageDefinition.directory, 'package.json'),
			'utf8',
		));
	}

	return {
		version: release.version,
		repository: release.repository,
		packages,
		templateManifest: JSON.parse(await readFile(join(REPOSITORY_ROOT, 'apps/starter/package.json'), 'utf8')),
	};
}

/**
 * Loads staged manifests and repository-owned release evidence.
 *
 * @param {{ version: string, repository: string }} release - Expected release identity.
 * @param {string} stagedRoot - Parent directory containing staged packages.
 * @returns {Promise<{ version: string, repository: string, changelog: string, rootLicensePresent: boolean, packages: Record<string, { manifest: Record<string, any>, licensePresent: boolean }> }>} Release validation input.
 */
async function readCandidateMetadata(release, stagedRoot) {
	const packages = {};

	for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
		const packageRoot = join(stagedRoot, packageDefinition.directory);

		packages[packageDefinition.directory] = {
			manifest: JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')),
			licensePresent: await pathExists(join(packageRoot, 'LICENSE')),
			...(packageDefinition.directory === 'create' ? { templateManifest: JSON.parse(await readFile(join(packageRoot, 'template/package.json'), 'utf8')) } : {}),
		};
	}

	return {
		version: release.version,
		repository: release.repository,
		changelog: await readOptionalText(join(REPOSITORY_ROOT, 'CHANGELOG.md')),
		rootLicensePresent: await pathExists(join(REPOSITORY_ROOT, 'LICENSE')),
		packages,
	};
}

/**
 * Runs npm's dry-run pack inspection for one staged package.
 *
 * @param {string} packageRoot - Staged package directory.
 * @param {NodeJS.ProcessEnv} environment - Isolated npm environment.
 * @returns {Record<string, any>} One npm pack result.
 */
function inspectPackage(packageRoot, environment) {
	const output = runCommand(
		NPM_COMMAND,
		['pack', '--dry-run', '--ignore-scripts', '--json'],
		packageRoot,
		environment,
	);

	return parseSinglePackResult(output);
}

/**
 * Creates one already-inspected package tarball in the candidate directory.
 *
 * @param {string} packageRoot - Staged package directory.
 * @param {string} destination - Candidate artifact directory.
 * @param {NodeJS.ProcessEnv} environment - Isolated npm environment.
 * @returns {Record<string, any>} One npm pack result.
 */
function packPackage(packageRoot, destination, environment) {
	const output = runCommand(
		NPM_COMMAND,
		['pack', '--ignore-scripts', '--json', '--pack-destination', destination],
		packageRoot,
		environment,
	);

	return parseSinglePackResult(output);
}

/**
 * Parses npm pack JSON while requiring exactly one package result.
 *
 * @param {string} output - npm pack JSON output.
 * @returns {Record<string, any>} Single package result.
 */
function parseSinglePackResult(output) {
	const results = JSON.parse(output);

	if (!Array.isArray(results) || results.length !== 1) {
		throw new Error('npm pack must return exactly one package result.');
	}

	return results[0];
}

/**
 * Runs a required command and returns standard output with full diagnostics.
 *
 * @param {string} command - Executable path or command name.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Working directory.
 * @param {NodeJS.ProcessEnv} environment - Command environment.
 * @returns {string} Captured standard output.
 */
function runCommand(command, args, cwd, environment) {
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

/**
 * Rejects broad or unexpected output roots before replacing candidate files.
 *
 * @param {string} outputRoot - Absolute output path.
 * @returns {void}
 */
function assertSafeOutputRoot(outputRoot) {
	if (!isAbsolute(outputRoot) || outputRoot === parse(outputRoot).root || outputRoot === REPOSITORY_ROOT) {
		throw new Error(`Unsafe framework release output root "${outputRoot}".`);
	}

	if (!isWithin(outputRoot, join(REPOSITORY_ROOT, 'dist')) && !isWithin(outputRoot, tmpdir())) {
		throw new Error('Framework release candidates may only be written under repository dist or the system temporary directory.');
	}
}

/**
 * Reports whether a candidate path is inside an allowed parent.
 *
 * @param {string} candidate - Absolute candidate path.
 * @param {string} parent - Absolute allowed parent path.
 * @returns {boolean} True when the candidate is below the parent.
 */
function isWithin(candidate, parent) {
	const childPath = relative(parent, candidate);

	return childPath !== '' && !childPath.startsWith('..') && !isAbsolute(childPath);
}

/**
 * Reports whether a path exists without hiding non-absence errors.
 *
 * @param {string} path - File path to inspect.
 * @returns {Promise<boolean>} True when the path is accessible.
 */
async function pathExists(path) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;

		throw error;
	}
}

/**
 * Reads optional text, returning an empty string only when the file is absent.
 *
 * @param {string} path - Text file path.
 * @returns {Promise<string>} File contents or an empty string.
 */
async function readOptionalText(path) {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return '';

		throw error;
	}
}
