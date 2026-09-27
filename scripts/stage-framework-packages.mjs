#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { listStarterFiles } from '../packages/create/src/starterFiles.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_OUTPUT_ROOT = join(REPOSITORY_ROOT, 'dist', 'framework-packages');
const TYPESCRIPT_CLI = join(REPOSITORY_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const PACKAGE_ORDER = ['pure', 'app', 'create'];
const SUPPORTED_PACKAGES = new Set(PACKAGE_ORDER);
const PUBLIC_PACKAGE_NAMES = {
	pure: '@db3.ai/pure',
	app: '@db3.ai/app',
	create: '@db3.ai/create',
};
const options = parseArguments(process.argv.slice(2));

assertSafeOutputRoot(options.outputRoot);
await mkdir(options.outputRoot, { recursive: true });

for (const packageName of options.packageNames) {
	await stagePackage(packageName, options.outputRoot, options.repositoryUrl);
}

/**
 * Parses package-selection and output options for the staging command.
 *
 * @param {string[]} args - Command-line arguments after the executable name.
 * @returns {{ packageNames: string[], outputRoot: string, repositoryUrl: string | null }} Parsed staging options.
 */
function parseArguments(args) {
	const packageNames = [];
	let outputRoot = DEFAULT_OUTPUT_ROOT;
	let repositoryUrl = process.env.DB3_FRAMEWORK_REPOSITORY_URL?.trim() || null;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === '--package') {
			const packageName = args[index + 1];

			if (!packageName || !SUPPORTED_PACKAGES.has(packageName)) {
				throw new Error('--package must be followed by "pure", "app" or "create".');
			}

			packageNames.push(packageName);
			index += 1;
			continue;
		}

		if (argument === '--output') {
			const output = args[index + 1];

			if (!output) {
				throw new Error('--output requires a directory path.');
			}

			outputRoot = resolve(process.cwd(), output);
			index += 1;
			continue;
		}

		if (argument === '--repository-url') {
			const value = args[index + 1];

			if (!value) {
				throw new Error('--repository-url requires a public GitHub repository URL.');
			}

			repositoryUrl = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown framework package staging option "${argument}".`);
	}

	if (repositoryUrl) assertPublicGitHubRepositoryUrl(repositoryUrl);

	return {
		packageNames: packageNames.length > 0
			? [...new Set(packageNames)]
			: PACKAGE_ORDER,
		outputRoot,
		repositoryUrl,
	};
}

/**
 * Validates repository metadata required for npm provenance publication.
 *
 * npm compares this value to the GitHub repository that runs the trusted
 * publisher workflow. Requiring one canonical form prevents accidental private,
 * local, credential-bearing, or ambiguous repository metadata.
 *
 * @param {string} repositoryUrl - Candidate npm repository URL.
 * @returns {void}
 */
function assertPublicGitHubRepositoryUrl(repositoryUrl) {
	if (!repositoryUrl.startsWith('git+https://')) {
		throw new Error('Framework repository URL must use git+https://github.com/<owner>/<repo>.git.');
	}

	const url = new URL(repositoryUrl.slice('git+'.length));
	const validPath = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(url.pathname);

	if (url.protocol !== 'https:'
		|| url.hostname !== 'github.com'
		|| url.username
		|| url.password
		|| url.port
		|| url.search
		|| url.hash
		|| !validPath) {
		throw new Error('Framework repository URL must use git+https://github.com/<owner>/<repo>.git.');
	}
}

/**
 * Rejects broad or unexpected output roots before any generated directory is replaced.
 *
 * @param {string} outputRoot - Absolute staging root requested by the caller.
 * @returns {void}
 */
function assertSafeOutputRoot(outputRoot) {
	if (!isAbsolute(outputRoot) || outputRoot === parse(outputRoot).root || outputRoot === REPOSITORY_ROOT) {
		throw new Error(`Unsafe framework package output root "${outputRoot}".`);
	}

	if (!isWithin(outputRoot, join(REPOSITORY_ROOT, 'dist')) && !isWithin(outputRoot, tmpdir())) {
		throw new Error('Framework packages may only be staged under repository dist or the system temporary directory.');
	}
}

/**
 * Reports whether a candidate path is contained by an allowed parent directory.
 *
 * @param {string} candidate - Absolute path to validate.
 * @param {string} parent - Absolute allowed parent path.
 * @returns {boolean} True when the candidate is inside the parent.
 */
function isWithin(candidate, parent) {
	const childPath = relative(parent, candidate);

	return childPath !== '' && !childPath.startsWith('..') && !isAbsolute(childPath);
}

/**
 * Compiles and assembles one framework package without changing its workspace manifest.
 *
 * @param {'app' | 'pure' | 'create'} packageName - Framework workspace package to stage.
 * @param {string} outputRoot - Parent directory for generated packages.
 * @param {string | null} repositoryUrl - Exact public GitHub source URL, when established.
 * @returns {Promise<void>}
 */
async function stagePackage(packageName, outputRoot, repositoryUrl) {
	if (packageName === 'create') {
		await stageCreatePackage(outputRoot, repositoryUrl);
		return;
	}

	const packageRoot = join(REPOSITORY_ROOT, 'packages', packageName);
	const sourceRoot = join(packageRoot, 'src');
	const stageRoot = join(outputRoot, packageName);
	const buildRoot = join(outputRoot, '.build', packageName);

	await rm(stageRoot, { recursive: true, force: true });
	await rm(buildRoot, { recursive: true, force: true });
	await mkdir(buildRoot, { recursive: true });

	runCommand(process.execPath, [
		TYPESCRIPT_CLI,
		'-p',
		join(packageRoot, 'tsconfig.json'),
		'--rootDir',
		sourceRoot,
		'--outDir',
		buildRoot,
		'--sourceMap',
		'false',
		'--declaration',
		'true',
		'--declarationMap',
		'false',
	], REPOSITORY_ROOT);

	await cp(buildRoot, join(stageRoot, 'dist'), { recursive: true });
	if (packageName === 'app') {
		// TypeScript references declaration inputs but does not copy them into outDir.
		await cp(join(sourceRoot, 'ai', 'sdkNodeCompatibility.d.ts'), join(stageRoot, 'dist', 'ai', 'sdkNodeCompatibility.d.ts'));
		const declarationPath = join(stageRoot, 'dist', 'ai', 'Ai.d.ts');
		const declaration = await readFile(declarationPath, 'utf8');
		const reference = /(<reference path=")[^"]*\/sdkNodeCompatibility\.d\.ts(")/;
		if (!reference.test(declaration)) throw new Error('The AI declaration must reference the SDK compatibility input.');
		await writeFile(declarationPath, declaration.replace(reference, '$1./sdkNodeCompatibility.d.ts$2'));
	}
	await rewriteCompiledSpecifiers(join(stageRoot, 'dist'));
	await copyPackageAssets(packageName, packageRoot, stageRoot);
	await writePublishManifest(packageName, packageRoot, stageRoot, repositoryUrl);
	await rm(buildRoot, { recursive: true, force: true });

	console.log(`Staged ${PUBLIC_PACKAGE_NAMES[packageName]} at ${stageRoot}.`);
}

/**
 * Stages the application creator with its reviewed template and matching App version.
 *
 * The creator is native ESM and needs no TypeScript compilation. Its template
 * retains application test/build scripts while the package itself has none.
 *
 * @param {string} outputRoot - Parent directory for generated packages.
 * @param {string | null} repositoryUrl - Public source URL used for provenance.
 * @returns {Promise<void>}
 */
async function stageCreatePackage(outputRoot, repositoryUrl) {
	const packageRoot = join(REPOSITORY_ROOT, 'packages', 'create');
	const stageRoot = join(outputRoot, 'create');
	const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
	const starterRoot = join(REPOSITORY_ROOT, 'apps', 'starter');
	const template = JSON.parse(await readFile(join(starterRoot, 'package.json'), 'utf8'));
	const appManifest = JSON.parse(await readFile(join(REPOSITORY_ROOT, 'packages', 'app', 'package.json'), 'utf8'));
	if (manifest.version !== appManifest.version || template.dependencies?.['@db3.ai/app'] !== appManifest.version) {
		throw new Error('Create and its template must use the exact App release version before staging.');
	}

	await rm(stageRoot, { recursive: true, force: true });
	await mkdir(stageRoot, { recursive: true });
	for (const entry of ['bin', 'src', 'README.md', 'LICENSE']) {
		await cp(join(packageRoot, entry), join(stageRoot, entry), { recursive: true });
	}
	for (const file of await listStarterFiles(starterRoot)) {
		const target = join(stageRoot, 'template', file);
		await mkdir(dirname(target), { recursive: true });
		await cp(join(starterRoot, file), target);
	}
	delete manifest.private;
	delete manifest.scripts;
	delete manifest.devDependencies;
	delete manifest.repository;
	manifest.files = ['bin', 'src', 'template', 'README.md', 'LICENSE'];
	manifest.publishConfig = { access: 'public', registry: 'https://registry.npmjs.org/' };
	if (repositoryUrl) {
		manifest.repository = { type: 'git', url: repositoryUrl, directory: 'packages/create' };
		manifest.publishConfig.provenance = true;
	}
	await writeFile(join(stageRoot, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');
	console.log(`Staged ${PUBLIC_PACKAGE_NAMES.create} at ${stageRoot}.`);
}

/**
 * Runs a required local build command and surfaces its complete diagnostic output.
 *
 * @param {string} command - Executable path.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Working directory for the command.
 * @returns {void}
 */
function runCommand(command, args, cwd) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
	});

	if (result.status !== 0) {
		throw new Error([
			`Command failed: ${command} ${args.join(' ')}`,
			result.stdout,
			result.stderr,
		].filter(Boolean).join('\n'));
	}
}

/**
 * Rewrites emitted relative module specifiers for standards-compliant Node ESM loading.
 *
 * TypeScript's bundler resolution accepts extensionless source imports but preserves
 * them in emitted JavaScript and declarations. Published ESM must identify the
 * concrete JavaScript file, including directory index modules.
 *
 * @param {string} directory - Compiled output tree.
 * @returns {Promise<void>}
 */
async function rewriteCompiledSpecifiers(directory) {
	for (const filePath of await listFiles(directory)) {
		const declaration = filePath.endsWith('.d.ts');

		if (!declaration && !filePath.endsWith('.js')) continue;

		const original = await readFile(filePath, 'utf8');
		const rewritten = original.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?(?:\/[^'"]+)?)\2/g, (match, prefix, quote, specifier) => {
			const resolved = resolveCompiledSpecifier(filePath, specifier, declaration);

			return resolved === specifier ? match : `${prefix}${quote}${resolved}${quote}`;
		});

		if (rewritten !== original) {
			await writeFile(filePath, rewritten, 'utf8');
		}
	}
}

/**
 * Resolves one emitted relative specifier to a concrete JavaScript module path.
 *
 * @param {string} filePath - Emitted JavaScript or declaration file containing the import.
 * @param {string} specifier - Relative module specifier found in the file.
 * @param {boolean} declaration - Whether the containing file is a declaration.
 * @returns {string} ESM-safe module specifier.
 */
function resolveCompiledSpecifier(filePath, specifier, declaration) {
	if (extname(specifier)) return specifier;

	const candidate = resolve(dirname(filePath), specifier);
	const emittedExtension = declaration ? '.d.ts' : '.js';

	if (existsSync(`${candidate}${emittedExtension}`)) {
		return `${specifier}.js`;
	}

	if (existsSync(join(candidate, `index${emittedExtension}`))) {
		return `${specifier}/index.js`;
	}

	return specifier;
}

/**
 * Recursively lists files below a generated directory.
 *
 * @param {string} directory - Directory to scan.
 * @returns {Promise<string[]>} Absolute file paths.
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
 * Copies consumer documentation, examples, and agent-scaffold assets into a package.
 *
 * @param {'app' | 'pure'} packageName - Package being staged.
 * @param {string} packageRoot - Workspace package root.
 * @param {string} stageRoot - Generated package root.
 * @returns {Promise<void>}
 */
async function copyPackageAssets(packageName, packageRoot, stageRoot) {
	await cp(join(packageRoot, 'README.md'), join(stageRoot, 'README.md'));

	const repositoryLicense = join(REPOSITORY_ROOT, 'LICENSE');

	if (existsSync(repositoryLicense)) {
		await cp(repositoryLicense, join(stageRoot, 'LICENSE'));
	}

	if (packageName === 'pure') {
		await cp(join(packageRoot, 'examples'), join(stageRoot, 'examples'), { recursive: true });
		return;
	}

	await cp(join(packageRoot, 'agent-instructions.md'), join(stageRoot, 'agent-instructions.md'));
	await cp(join(packageRoot, 'bin'), join(stageRoot, 'bin'), { recursive: true });
	await cp(join(packageRoot, 'templates'), join(stageRoot, 'templates'), { recursive: true });
	await copyProductionSource(join(packageRoot, 'src'), join(stageRoot, 'src'));

	for (const service of ['ai', 'auth', 'cache', 'config', 'db', 'events', 'flows', 'logging', 'mail', 'in-app', 'media', 'network', 'notifications', 'queue', 'scheduler', 'security', 'serialization', 'server', 'ssr', 'storage', 'url', 'validation', 'websocket']) {
		await cp(
			join(packageRoot, 'src', service, 'examples'),
			join(stageRoot, 'src', service, 'examples'),
			{ recursive: true },
		);
	}
}

/**
 * Copies documented production TypeScript while excluding package-owned tests and examples.
 *
 * Shipping production source keeps service README links useful to installed-package
 * consumers. Behaviour tests remain source-repository verification, while selected
 * service examples are added separately as intentional consumer documentation.
 *
 * @param {string} sourceDirectory - Workspace source directory to copy.
 * @param {string} targetDirectory - Installed source-context directory.
 * @returns {Promise<void>}
 */
async function copyProductionSource(sourceDirectory, targetDirectory) {
	await mkdir(targetDirectory, { recursive: true });

	for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
		if (entry.isDirectory() && (entry.name === 'tests' || entry.name === 'examples')) {
			continue;
		}

		const sourcePath = join(sourceDirectory, entry.name);
		const targetPath = join(targetDirectory, entry.name);

		if (entry.isDirectory()) {
			await copyProductionSource(sourcePath, targetPath);
		} else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name === 'README.md')) {
			await cp(sourcePath, targetPath);
		}
	}
}

/**
 * Creates a publishable manifest whose exports point at compiled runtime and type files.
 *
 * @param {'app' | 'pure'} packageName - Package being staged.
 * @param {string} packageRoot - Workspace package root.
 * @param {string} stageRoot - Generated package root.
 * @param {string | null} repositoryUrl - Exact public GitHub source URL, when established.
 * @returns {Promise<void>}
 */
async function writePublishManifest(packageName, packageRoot, stageRoot, repositoryUrl) {
	const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
	const rootExport = builtExport(manifest.exports['.']);

	delete manifest.private;
	delete manifest.scripts;
	delete manifest.devDependencies;
	delete manifest.repository;

	manifest.main = rootExport.default;
	manifest.types = rootExport.types;
	manifest.exports = Object.fromEntries(
		Object.entries(manifest.exports).map(([subpath, target]) => [
			subpath,
			typeof target === 'string' && target.startsWith('./src/') ? builtExport(target) : target,
		]),
	);
	const files = packageName === 'app'
		? ['dist', 'README.md', 'agent-instructions.md', 'bin', 'templates', 'src']
		: ['dist', 'examples', 'README.md'];

	if (existsSync(join(stageRoot, 'LICENSE'))) {
		files.push('LICENSE');
	}

	manifest.files = files;
	manifest.publishConfig = {
		access: 'public',
		registry: 'https://registry.npmjs.org/',
	};

	if (repositoryUrl) {
		manifest.repository = {
			type: 'git',
			url: repositoryUrl,
			directory: `packages/${packageName}`,
		};
		manifest.publishConfig.provenance = true;
	}

	await writeFile(
		join(stageRoot, 'package.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`,
		'utf8',
	);
}

/**
 * Converts one workspace TypeScript export target into runtime and declaration conditions.
 *
 * @param {string} target - Source export target from the workspace manifest.
 * @returns {{ types: string, import: string, default: string }} Built export conditions.
 */
function builtExport(target) {
	if (typeof target !== 'string' || !target.startsWith('./src/') || !target.endsWith('.ts')) {
		throw new Error(`Unsupported framework source export target "${String(target)}".`);
	}

	const basePath = `./dist/${target.slice('./src/'.length, -'.ts'.length)}`;

	return {
		types: `${basePath}.d.ts`,
		import: `${basePath}.js`,
		default: `${basePath}.js`,
	};
}
