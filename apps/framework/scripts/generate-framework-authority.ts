import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PUBLIC_APP_PACKAGE = '@db3.ai/app';
const privateRepositoryMarkers = [
	'github.com/steve-obrien/platform',
	'git@github.com:steve-obrien/platform',
	'/Users/steve/',
];

/**
 * Minimal article evidence used to capture behavioural-test authority.
 */
export interface FrameworkAuthorityArticle {
	/** Package-relative declarations explicitly selected by a reference article. */
	declarationPaths?: readonly string[];
	/** Registry-owned behavioural test for the article. */
	testPath?: string;
	/** Tests for additional examples, without changing the primary verified workflow. */
	additionalTestPaths?: readonly string[];
	/** Rich verified-example evidence rendered by the article. */
	verifiedExample?: {
		/** Service-owned behavioural test that executes the example. */
		testPath: string;
	};
}

/**
 * One concrete public TypeScript subpath in the staged consumer package.
 */
export interface FrameworkPublicExport {
	/** Package export key, with wildcard exports expanded to concrete modules. */
	subpath: string;
	/** Import specifier a consuming application should use. */
	importPath: string;
	/** Package-relative emitted declaration file used by TypeScript consumers. */
	declarationPath: string;
}

/**
 * Publish-shaped framework authority embedded into the AI documentation.
 */
export interface FrameworkAuthority {
	/** Public package name read from the staged package manifest. */
	packageName: string;
	/** Framework version read from the staged package manifest. */
	version: string;
	/** Supported Node.js range declared by the staged package. */
	nodeVersion: string;
	/** Concrete public TypeScript imports and their declaration entry points. */
	publicExports: FrameworkPublicExport[];
	/** Exact entry points and selected reference declarations, keyed by package-relative path. */
	declarationSources: Record<string, string>;
	/** Exact service-owned behavioural tests using the public package imports. */
	behaviourTestSources: Record<string, string>;
	/** Companion portable package inventory, captured from the same release stage. */
	pure: {
		publicExports: FrameworkPublicExport[];
		declarationSources: Record<string, string>;
	};
}

/**
 * Staged package export conditions used by TypeScript and ESM consumers.
 */
interface StagedExportConditions {
	types?: string;
	import?: string;
	default?: string;
}

/**
 * Publish-shaped subset of the staged framework package manifest.
 */
interface StagedFrameworkManifest {
	name?: string;
	version?: string;
	engines?: {
		node?: string;
	};
	repository?: unknown;
	exports?: Record<string, string | StagedExportConditions>;
}

/**
 * Staged framework metadata after required public-package fields are checked.
 */
interface ValidatedStagedFrameworkManifest extends StagedFrameworkManifest {
	name: string;
	version: string;
	engines: {
		node: string;
	};
	exports: Record<string, string | StagedExportConditions>;
}

/**
 * Compiles the framework through its consumer-package staging workflow and
 * captures exact declaration and behavioural-test authority for public docs.
 *
 * A temporary stage prevents checked-in or locally stale `dist` artifacts from
 * influencing the website. The staging command is also responsible for the
 * publish manifest, so documentation follows the same subpaths consumers get.
 *
 * @param repoRoot - Absolute repository root URL.
 * @param articles - Documentation registry entries that cite behavioural tests.
 * @returns Fresh publish-shaped API and test authority for generated docs.
 */
export async function generateFrameworkAuthority(
	repoRoot: URL,
	articles: readonly FrameworkAuthorityArticle[],
): Promise<FrameworkAuthority> {
	const repositoryRootPath = fileURLToPath(repoRoot);
	const stageRoot = await mkdtemp(join(tmpdir(), 'db3-docs-framework-authority-'));

	try {
		await execFileAsync(process.execPath, [
			join(repositoryRootPath, 'scripts', 'stage-framework-packages.mjs'),
			'--output',
			stageRoot,
		], {
			cwd: repositoryRootPath,
			env: {
				...process.env,
				DB3_FRAMEWORK_REPOSITORY_URL: '',
			},
			maxBuffer: 10 * 1024 * 1024,
		});

		const stagedPackageRoot = join(stageRoot, 'app');
		const manifest = JSON.parse(
			await readFile(join(stagedPackageRoot, 'package.json'), 'utf8'),
		) as StagedFrameworkManifest;
		assertStagedManifest(manifest);

		const publicExports = await resolvePublicExports(stagedPackageRoot, manifest);
		const declarationSources = await readDeclarationSources(stagedPackageRoot, publicExports, articles.flatMap(article => article.declarationPaths ?? []));
		const behaviourTestSources = await readBehaviourTestSources(repositoryRootPath, articles);
		const pureRoot = join(stageRoot, 'pure');
		const pureManifest = JSON.parse(await readFile(join(pureRoot, 'package.json'), 'utf8')) as StagedFrameworkManifest;
		assertStagedManifest(pureManifest, '@db3.ai/pure');
		const pureExports = await resolvePublicExports(pureRoot, pureManifest);
		const authority: FrameworkAuthority = {
			packageName: manifest.name,
			version: manifest.version,
			nodeVersion: manifest.engines.node,
			publicExports,
			declarationSources,
			behaviourTestSources,
			pure: { publicExports: pureExports, declarationSources: await readDeclarationSources(pureRoot, pureExports, []) },
		};

		assertPublicAuthorityIsSafe(authority);

		return authority;
	} finally {
		await rm(stageRoot, { recursive: true, force: true });
	}
}

/**
 * Validates the publish-shaped package metadata needed by documentation.
 *
 * @param manifest - Manifest produced by the package staging workflow.
 * @param expectedPackage - Public package identity required for this snapshot.
 * @returns Nothing after the manifest has been narrowed to required fields.
 */
function assertStagedManifest(manifest: StagedFrameworkManifest, expectedPackage = PUBLIC_APP_PACKAGE): asserts manifest is ValidatedStagedFrameworkManifest {
	if (manifest.name !== expectedPackage || typeof manifest.version !== 'string' || manifest.version === '') {
		throw new Error(`The staged framework package must identify a versioned ${expectedPackage} artifact.`);
	}

	if (typeof manifest.engines?.node !== 'string' || manifest.engines.node === '') {
		throw new Error('The staged framework package must declare its supported Node.js range.');
	}

	if (!manifest.exports || Object.keys(manifest.exports).length === 0) {
		throw new Error('The staged framework package must expose at least one public subpath.');
	}

	if (manifest.repository !== undefined) {
		throw new Error('The staged framework package must not expose a private repository location.');
	}
}

/**
 * Resolves every typed staged export, expanding wildcard declarations into the
 * concrete import paths a consumer can address.
 *
 * @param stagedPackageRoot - Absolute root of the temporary staged package.
 * @param manifest - Validated publish-shaped package manifest.
 * @returns Sorted concrete public TypeScript export inventory.
 */
async function resolvePublicExports(
	stagedPackageRoot: string,
	manifest: ValidatedStagedFrameworkManifest,
): Promise<FrameworkPublicExport[]> {
	const publicExports: FrameworkPublicExport[] = [];

	for (const [subpath, conditions] of Object.entries(manifest.exports)) {
		if (typeof conditions === 'string' || typeof conditions.types !== 'string') continue;

		if (subpath.includes('*') || conditions.types.includes('*')) {
			publicExports.push(...await expandWildcardExport(stagedPackageRoot, manifest.name, subpath, conditions.types));
			continue;
		}

		publicExports.push(createPublicExport(stagedPackageRoot, manifest.name, subpath, conditions.types));
	}

	return publicExports.sort((left, right) => left.importPath.localeCompare(right.importPath));
}

/**
 * Expands one matched package export pattern into concrete declaration files.
 *
 * @param stagedPackageRoot - Absolute root of the temporary staged package.
 * @param packageName - Public npm package name.
 * @param subpathPattern - Package export key containing one wildcard.
 * @param declarationPattern - Declaration target containing one wildcard.
 * @returns Concrete public imports supplied by the wildcard export.
 */
async function expandWildcardExport(
	stagedPackageRoot: string,
	packageName: string,
	subpathPattern: string,
	declarationPattern: string,
): Promise<FrameworkPublicExport[]> {
	if (countWildcards(subpathPattern) !== 1 || countWildcards(declarationPattern) !== 1) {
		throw new Error(`Public export patterns must contain one wildcard: ${subpathPattern} -> ${declarationPattern}`);
	}

	const declarationRelativePattern = packageRelativePath(declarationPattern);
	const declarationDirectory = resolve(stagedPackageRoot, dirname(declarationRelativePattern));
	assertWithinPackage(stagedPackageRoot, declarationDirectory);

	const filenamePattern = basename(declarationRelativePattern);
	const [filenamePrefix, filenameSuffix] = filenamePattern.split('*');
	const entries = await readdir(declarationDirectory, { withFileTypes: true });
	const publicExports = entries
		.filter(entry => entry.isFile() && entry.name.startsWith(filenamePrefix) && entry.name.endsWith(filenameSuffix))
		.map(entry => entry.name.slice(filenamePrefix.length, entry.name.length - filenameSuffix.length))
		.filter(wildcard => wildcard !== '')
		.map(wildcard => createPublicExport(
			stagedPackageRoot,
			packageName,
			subpathPattern.replace('*', wildcard),
			declarationPattern.replace('*', wildcard),
		));

	if (publicExports.length === 0) {
		throw new Error(`The public export pattern ${subpathPattern} did not match any staged declarations.`);
	}

	return publicExports;
}

/**
 * Creates one concrete public export after validating its declaration target.
 *
 * @param stagedPackageRoot - Absolute root of the temporary staged package.
 * @param packageName - Public npm package name.
 * @param subpath - Concrete package export key.
 * @param declarationTarget - Concrete staged declaration target.
 * @returns Consumer import and package-relative declaration record.
 */
function createPublicExport(
	stagedPackageRoot: string,
	packageName: string,
	subpath: string,
	declarationTarget: string,
): FrameworkPublicExport {
	const declarationPath = packageRelativePath(declarationTarget);
	assertWithinPackage(stagedPackageRoot, resolve(stagedPackageRoot, declarationPath));

	return {
		subpath,
		importPath: subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`,
		declarationPath,
	};
}

/**
 * Reads exact staged entry points and selected reference declarations once.
 *
 * @param stagedPackageRoot - Absolute root of the temporary staged package.
 * @param publicExports - Concrete consumer export inventory.
 * @param referencePaths - Additional emitted files selected by reference articles.
 * @returns Declaration text keyed by package-relative staged path.
 */
async function readDeclarationSources(
	stagedPackageRoot: string,
	publicExports: readonly FrameworkPublicExport[],
	referencePaths: readonly string[],
): Promise<Record<string, string>> {
	const declarationPaths = [...new Set([...publicExports.map(entry => entry.declarationPath), ...referencePaths])].sort();
	const declarations = await Promise.all(declarationPaths.map(async declarationPath => {
		if (!declarationPath.endsWith('.d.ts')) throw new Error(`Expected an emitted declaration: ${declarationPath}`);
		assertWithinPackage(stagedPackageRoot, resolve(stagedPackageRoot, declarationPath));
		const source = await readFile(resolve(stagedPackageRoot, declarationPath), 'utf8');

		if (source.trim() === '') {
			throw new Error(`The staged declaration ${declarationPath} is empty.`);
		}

		return [declarationPath, source] as const;
	}));

	return Object.fromEntries(declarations);
}

/**
 * Reads each registry-cited behavioural test once and normalizes public imports.
 *
 * @param repositoryRootPath - Absolute repository root path.
 * @param articles - Documentation articles that cite test evidence.
 * @returns Consumer-facing behavioural-test source keyed by repository-relative path.
 */
async function readBehaviourTestSources(
	repositoryRootPath: string,
	articles: readonly FrameworkAuthorityArticle[],
): Promise<Record<string, string>> {
	const testPaths = [...new Set(articles.flatMap(article => [
		article.testPath,
		article.verifiedExample?.testPath,
		...(article.additionalTestPaths ?? []),
	].filter((testPath): testPath is string => Boolean(testPath))))].sort();
	const tests = await Promise.all(testPaths.map(async testPath => {
		const absolutePath = resolve(repositoryRootPath, testPath);
		assertWithinPackage(repositoryRootPath, absolutePath);
		const source = await readFile(absolutePath, 'utf8');

		if (source.trim() === '') {
			throw new Error(`The behavioural test ${testPath} is empty.`);
		}

		return [testPath, source] as const;
	}));

	return Object.fromEntries(tests);
}

/**
 * Removes the package-relative prefix from a staged manifest target.
 *
 * @param target - Manifest target expected to start with `./`.
 * @returns Safe relative path suitable for resolution below the package root.
 */
function packageRelativePath(target: string): string {
	if (!target.startsWith('./')) {
		throw new Error(`Public declaration targets must be package relative: ${target}`);
	}

	return target.slice(2);
}

/**
 * Prevents generated authority from reading outside its trusted root.
 *
 * @param root - Absolute allowed root.
 * @param candidate - Absolute path that must remain below the root.
 * @returns Nothing when the candidate is safely contained.
 */
function assertWithinPackage(root: string, candidate: string): void {
	const containedPath = relative(root, candidate);

	if (containedPath === '' || containedPath.startsWith('..') || resolve(root, containedPath) !== candidate) {
		throw new Error(`Generated framework authority path escapes its root: ${candidate}`);
	}
}

/**
 * Counts wildcard placeholders in one staged export pattern.
 *
 * @param value - Export key or declaration target.
 * @returns Number of wildcard placeholders in the value.
 */
function countWildcards(value: string): number {
	return value.split('*').length - 1;
}

/**
 * Rejects known private repository or workstation locations before generation.
 *
 * @param authority - Complete generated authority candidate.
 * @returns Nothing after the generated content is safe for public output.
 */
function assertPublicAuthorityIsSafe(authority: FrameworkAuthority): void {
	const publicContent = JSON.stringify(authority);
	const privateMarker = privateRepositoryMarkers.find(marker => publicContent.includes(marker));

	if (privateMarker) {
		throw new Error(`Generated framework authority contains a private location marker: ${privateMarker}`);
	}
}
