import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FRAMEWORK_RELEASE_PACKAGES,
	assertPackageInspection,
	collectReleaseArtifactIssues,
	collectReleaseContextIssues,
	collectSourceReleaseIssues,
	frameworkRepositoryUrl,
} from '../lib/framework-release-policy.mjs';

const VERSION = '1.2.3';
const REPOSITORY = 'example-org/db3-framework';

test('release policy fixes Pure before App and Create', () => {
	assert.deepEqual(
		FRAMEWORK_RELEASE_PACKAGES.map((packageDefinition) => packageDefinition.name),
		['@db3.ai/pure', '@db3.ai/app', '@db3.ai/create'],
	);
});

test('release context requires manual dispatch from an exact public annotated-tag candidate', () => {
	assert.deepEqual(collectReleaseContextIssues({
		eventName: 'workflow_dispatch',
		version: VERSION,
		confirmation: 'prepare framework-v1.2.3',
		repository: REPOSITORY,
		visibility: 'public',
		refType: 'tag',
		refName: 'framework-v1.2.3',
		defaultBranch: 'main',
	}), []);

	const issues = collectReleaseContextIssues({
		eventName: 'push',
		version: VERSION,
		confirmation: 'yes',
		repository: REPOSITORY,
		visibility: 'private',
		refType: 'branch',
		refName: 'main',
		defaultBranch: 'main',
	});

	assert.ok(issues.some((issue) => issue.includes('workflow_dispatch')));
	assert.ok(issues.some((issue) => issue.includes('dedicated public source repository')));
	assert.ok(issues.some((issue) => issue.includes('exact tag')));
});

test('release artifacts require lockstep public metadata, license and changelog evidence', () => {
	const validCandidate = createCandidate();

	assert.deepEqual(collectReleaseArtifactIssues(validCandidate), []);

	const invalidCandidate = createCandidate();
	invalidCandidate.rootLicensePresent = false;
	invalidCandidate.changelog = '# Changelog\n\n## [Unreleased]\n';
	invalidCandidate.packages.pure.manifest.license = undefined;
	invalidCandidate.packages.pure.manifest.publishConfig.provenance = false;
	invalidCandidate.packages.app.manifest.repository.url = 'git+https://github.com/private/monorepo.git';
	invalidCandidate.packages.app.manifest.dependencies['@db3.ai/pure'] = '^1.2.3';

	const issues = collectReleaseArtifactIssues(invalidCandidate);

	assert.ok(issues.some((issue) => issue.includes('root LICENSE')));
	assert.ok(issues.some((issue) => issue.includes('CHANGELOG.md')));
	assert.ok(issues.some((issue) => issue.includes('SPDX license')));
	assert.ok(issues.some((issue) => issue.includes('provenance must be true')));
	assert.ok(issues.some((issue) => issue.includes('private/monorepo') || issue.includes('repository metadata')));
	assert.ok(issues.some((issue) => issue.includes('exact version')));
});

test('release preparation rejects source versions and dependencies that do not match the requested tag', () => {
	const candidate = createCandidate();
	const source = {
		version: VERSION,
		repository: REPOSITORY,
		templateManifest: structuredClone(candidate.packages.create.templateManifest),
		packages: {
			pure: structuredClone(candidate.packages.pure.manifest),
			app: structuredClone(candidate.packages.app.manifest),
			create: structuredClone(candidate.packages.create.manifest),
		},
	};

	assert.deepEqual(collectSourceReleaseIssues(source), []);

	source.packages.pure.version = '1.2.2';
	source.packages.app.dependencies['@db3.ai/pure'] = '1.2.2';
	source.packages.app.repository.url = 'git+https://github.com/private/monorepo.git';

	const issues = collectSourceReleaseIssues(source);

	assert.ok(issues.some((issue) => issue.includes('version must already equal 1.2.3')));
	assert.ok(issues.some((issue) => issue.includes('exact version 1.2.3')));
	assert.ok(issues.some((issue) => issue.includes('repository metadata')));
});

test('source release validation rejects package scopes that differ from public names', () => {
	const candidate = createCandidate();
	const source = {
		version: VERSION,
		repository: REPOSITORY,
		templateManifest: structuredClone(candidate.packages.create.templateManifest),
		packages: {
			pure: structuredClone(candidate.packages.pure.manifest),
			app: structuredClone(candidate.packages.app.manifest),
			create: structuredClone(candidate.packages.create.manifest),
		},
	};

	source.packages.pure.name = '@workspace/pure';
	source.packages.app.name = '@workspace/app';
	delete source.packages.app.dependencies['@db3.ai/pure'];
	source.packages.app.dependencies['@workspace/pure'] = VERSION;

	const issues = collectSourceReleaseIssues(source);
	assert.ok(issues.some(issue => issue.includes('@db3.ai/pure source has unexpected name')));
	assert.ok(issues.some(issue => issue.includes('@db3.ai/app source has unexpected name')));
	assert.ok(issues.some(issue => issue.includes('App must depend on Pure at exact version')));
	assert.ok(issues.some(issue => issue.includes('only on the checked-in Pure package identity')));
});

test('npm pack inspection rejects repository-only files and incomplete package contents', () => {
	const inspection = createPackInspection();

	assert.doesNotThrow(() => assertPackageInspection({
		name: '@db3.ai/pure',
		version: VERSION,
	}, inspection));

	inspection.files = inspection.files
		.filter((file) => file.path !== 'LICENSE')
		.concat({ path: '.env.production' }, { path: 'src/strings/tests/strings.test.ts' });

	assert.throws(
		() => assertPackageInspection({ name: '@db3.ai/pure', version: VERSION }, inspection),
		/missing LICENSE[\s\S]*\.env\.production[\s\S]*tests\/strings\.test\.ts/,
	);
});

test('Create requires its exact template version and permits only intentional template assets', () => {
	const candidate = createCandidate();
	candidate.packages.create.templateManifest.dependencies['@db3.ai/app'] = '^1.2.3';
	assert.ok(collectReleaseArtifactIssues(candidate).some(issue => issue.includes("Create's template")));
	const inspection = {
		name: '@db3.ai/create', version: VERSION,
		files: ['package.json', 'README.md', 'LICENSE', 'bin/create.mjs', 'src/createProject.mjs', 'template/package.json', 'template/.env.example', 'template/server/app.ts', 'template/tests/app.test.ts', 'template/tsconfig.json', 'template/apps/social/tsconfig.build.json'].map(path => ({ path })),
	};
	assert.doesNotThrow(() => assertPackageInspection(inspection, inspection));
	for (const path of ['template/.env', 'template/.env.production', 'tests/createProject.test.mjs', 'template/node_modules/dependency/index.js', 'template/package-lock.json', 'template/apps/social/node_modules/private.js', 'template/apps/social/.env', 'template/apps/social/server/tsconfig.secret.json']) {
		assert.throws(() => assertPackageInspection(inspection, { ...inspection, files: [...inspection.files, { path }] }), /Unsafe npm pack result/);
	}
});

/**
 * Creates a complete lockstep candidate fixture.
 *
 * @returns {Record<string, any>} Candidate accepted by the release policy.
 */
function createCandidate() {
	return {
		version: VERSION,
		repository: REPOSITORY,
		changelog: '# Changelog\n\n## [1.2.3] - 2026-08-20\n\n- Initial test release.\n',
		rootLicensePresent: true,
		packages: {
			pure: {
				manifest: createManifest('pure'),
				licensePresent: true,
			},
			app: {
				manifest: createManifest('app'),
				licensePresent: true,
			},
			create: {
				manifest: createManifest('create'),
				templateManifest: { dependencies: { '@db3.ai/app': VERSION } },
				licensePresent: true,
			},
		},
	};
}

/**
 * Creates one valid staged package manifest fixture.
 *
 * @param {'app' | 'pure' | 'create'} directory - Framework package directory.
 * @returns {Record<string, any>} Valid staged manifest fixture.
 */
function createManifest(directory) {
	const name = `@db3.ai/${directory}`;

	return {
		name,
		version: VERSION,
		description: `${name} fixture`,
		license: 'MIT',
		type: 'module',
		repository: {
			type: 'git',
			url: frameworkRepositoryUrl(REPOSITORY),
			directory: `packages/${directory}`,
		},
		main: './dist/index.js',
		types: './dist/index.d.ts',
		exports: {
			'.': {
				types: './dist/index.d.ts',
				import: './dist/index.js',
				default: './dist/index.js',
			},
		},
		files: ['dist', 'README.md', 'LICENSE'],
		publishConfig: {
			access: 'public',
			registry: 'https://registry.npmjs.org/',
			provenance: true,
		},
		dependencies: directory === 'app'
			? { '@db3.ai/pure': VERSION }
			: undefined,
	};
}

/**
 * Creates a safe npm pack JSON result fixture.
 *
 * @returns {Record<string, any>} Pack inspection accepted by the release policy.
 */
function createPackInspection() {
	return {
		name: '@db3.ai/pure',
		version: VERSION,
		files: [
			{ path: 'package.json' },
			{ path: 'README.md' },
			{ path: 'LICENSE' },
			{ path: 'dist/index.js' },
			{ path: 'dist/index.d.ts' },
		],
	};
}
