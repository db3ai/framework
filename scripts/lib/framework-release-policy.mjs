const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const NPM_REGISTRY = 'https://registry.npmjs.org/';

/**
 * Framework packages in their mandatory verification and publication order.
 *
 * App consumes the matching Pure version, so callers must never reverse this
 * order when packing, staging, approving, or publishing a release.
 */
export const FRAMEWORK_RELEASE_PACKAGES = Object.freeze([
	Object.freeze({ directory: 'pure', name: '@db3.ai/pure' }),
	Object.freeze({ directory: 'app', name: '@db3.ai/app' }),
]);

/**
 * Returns the release tag associated with a lockstep framework version.
 *
 * @param {string} version - Valid package version.
 * @returns {string} Repository tag for the release set.
 */
export function frameworkReleaseTag(version) {
	return `framework-v${version}`;
}

/**
 * Reports whether a version is a strict SemVer release without build metadata.
 *
 * Build metadata is intentionally rejected because npm ignores it for version
 * precedence while Git tags do not, which can make release identity ambiguous.
 *
 * @param {unknown} version - Candidate version value.
 * @returns {version is string} True for an accepted release version.
 */
export function isFrameworkReleaseVersion(version) {
	return typeof version === 'string' && RELEASE_VERSION_PATTERN.test(version);
}

/**
 * Reports whether a value identifies one GitHub repository as `owner/name`.
 *
 * @param {unknown} repository - Candidate GitHub repository identifier.
 * @returns {repository is string} True for a syntactically safe identifier.
 */
export function isGitHubRepository(repository) {
	if (typeof repository !== 'string') return false;

	const [owner, name, extra] = repository.split('/');

	return extra === undefined
		&& GITHUB_OWNER_PATTERN.test(owner)
		&& GITHUB_REPOSITORY_NAME_PATTERN.test(name)
		&& name !== '.'
		&& name !== '..'
		&& !name.endsWith('.git');
}

/**
 * Builds the canonical package-manifest repository URL for a GitHub project.
 *
 * @param {string} repository - GitHub repository in `owner/name` form.
 * @returns {string} Git URL expected by npm provenance validation.
 */
export function frameworkRepositoryUrl(repository) {
	return `git+https://github.com/${repository}.git`;
}

/**
 * Collects safety failures from a manually dispatched release-candidate run.
 *
 * @param {{ eventName?: string, version?: string, confirmation?: string, repository?: string, visibility?: string, refType?: string, refName?: string, defaultBranch?: string }} context - GitHub Actions release context.
 * @returns {string[]} Human-readable policy failures.
 */
export function collectReleaseContextIssues(context) {
	const issues = [];
	const version = context.version ?? '';
	const expectedTag = frameworkReleaseTag(version);

	if (context.eventName !== 'workflow_dispatch') {
		issues.push('Release candidates must be started with workflow_dispatch.');
	}

	if (!isFrameworkReleaseVersion(version)) {
		issues.push(`Release version "${version}" is not accepted SemVer.`);
	}

	if (context.confirmation !== `prepare ${expectedTag}`) {
		issues.push(`Confirmation must exactly equal "prepare ${expectedTag}".`);
	}

	if (!isGitHubRepository(context.repository)) {
		issues.push('GITHUB_REPOSITORY must identify one repository as owner/name.');
	}

	if (context.visibility !== 'public') {
		issues.push('Framework release candidates must run from the dedicated public source repository.');
	}

	if (context.refType !== 'tag' || context.refName !== expectedTag) {
		issues.push(`Dispatch the workflow from the exact tag "${expectedTag}".`);
	}

	if (typeof context.defaultBranch !== 'string' || context.defaultBranch.trim() === '') {
		issues.push('The public repository must expose its default branch to the release gate.');
	}

	return issues;
}

/**
 * Collects package metadata failures that would make a candidate unsafe to publish.
 *
 * @param {{ version: string, repository: string, changelog: string, rootLicensePresent: boolean, packages: Record<string, { manifest: Record<string, any>, licensePresent: boolean }> }} candidate - Staged framework release metadata.
 * @returns {string[]} Human-readable release blockers.
 */
export function collectReleaseArtifactIssues(candidate) {
	const issues = [];
	const expectedRepositoryUrl = isGitHubRepository(candidate.repository)
		? frameworkRepositoryUrl(candidate.repository)
		: null;

	if (!isFrameworkReleaseVersion(candidate.version)) {
		issues.push(`Release version "${candidate.version}" is not accepted SemVer.`);
	}

	if (!expectedRepositoryUrl) {
		issues.push('Release repository must identify one GitHub repository as owner/name.');
	}

	if (!candidate.rootLicensePresent) {
		issues.push('The public framework repository must contain a reviewed root LICENSE file.');
	}

	if (!changelogContainsRelease(candidate.changelog, candidate.version)) {
		issues.push(`CHANGELOG.md must contain a dated "## [${candidate.version}] - YYYY-MM-DD" release heading.`);
	}

	for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
		const stagedPackage = candidate.packages[packageDefinition.directory];

		if (!stagedPackage) {
			issues.push(`Missing staged ${packageDefinition.name} package.`);
			continue;
		}

		collectPackageManifestIssues(
			issues,
			packageDefinition,
			stagedPackage,
			candidate.version,
			expectedRepositoryUrl,
		);
	}

	const appManifest = candidate.packages.app?.manifest;

	if (appManifest?.dependencies?.['@db3.ai/pure'] !== candidate.version) {
		issues.push(`@db3.ai/app must depend on @db3.ai/pure at exact version ${candidate.version}.`);
	}

	return issues;
}

/**
 * Collects checked-in source-manifest failures before staging a candidate.
 *
 * Release preparation must validate, not manufacture, package versions. This
 * prevents a tagged workflow from assembling source whose reviewed manifests
 * still describe another release.
 *
 * @param {{ version: string, repository: string, packages: Record<string, Record<string, any>> }} source - Checked-in release metadata.
 * @returns {string[]} Human-readable source blockers.
 */
export function collectSourceReleaseIssues(source) {
	const issues = [];
	const repositoryUrl = isGitHubRepository(source.repository)
		? frameworkRepositoryUrl(source.repository)
		: null;

	for (const packageDefinition of FRAMEWORK_RELEASE_PACKAGES) {
		const manifest = source.packages[packageDefinition.directory];

		if (!manifest) {
			issues.push(`Missing checked-in packages/${packageDefinition.directory}/package.json.`);
			continue;
		}

		if (!isSourceFrameworkPackageName(manifest.name, packageDefinition.directory)) {
			issues.push(`Checked-in ${packageDefinition.name} source has unexpected name "${String(manifest.name)}".`);
		}

		if (manifest.version !== source.version) {
			issues.push(`Checked-in ${packageDefinition.name} version must already equal ${source.version}.`);
		}

		if (
			manifest.repository?.type !== 'git'
			|| manifest.repository?.url !== repositoryUrl
			|| manifest.repository?.directory !== `packages/${packageDefinition.directory}`
		) {
			issues.push(`Checked-in ${packageDefinition.name} repository metadata must point to ${repositoryUrl ?? 'the public repository'}#packages/${packageDefinition.directory}.`);
		}
	}

	const appDependencies = source.packages.app?.dependencies ?? {};
	const pureSourceName = source.packages.pure?.name;
	const pureDependency = typeof pureSourceName === 'string'
		? appDependencies[pureSourceName]
		: undefined;

	if (pureDependency !== source.version) {
		issues.push(`Checked-in App must depend on Pure at exact version ${source.version}.`);
	}

	const alternatePureDependencies = Object.keys(appDependencies)
		.filter((dependencyName) => dependencyName !== pureSourceName && isSourceFrameworkPackageName(dependencyName, 'pure'));

	if (alternatePureDependencies.length > 0) {
		issues.push('Checked-in App must depend only on the checked-in Pure package identity.');
	}

	return issues;
}

/**
 * Rejects unexpected or incomplete files reported by `npm pack --dry-run`.
 *
 * @param {{ name: string, version: string }} expected - Expected package identity.
 * @param {Record<string, any>} inspection - One result object from npm pack JSON output.
 * @returns {void}
 */
export function assertPackageInspection(expected, inspection) {
	const issues = [];
	const files = Array.isArray(inspection.files) ? inspection.files : [];
	const filePaths = files.map((file) => file?.path).filter((path) => typeof path === 'string');
	const requiredFiles = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];

	if (inspection.name !== expected.name) {
		issues.push(`npm pack reported package name "${String(inspection.name)}" instead of "${expected.name}".`);
	}

	if (inspection.version !== expected.version) {
		issues.push(`npm pack reported version "${String(inspection.version)}" instead of "${expected.version}".`);
	}

	for (const requiredFile of requiredFiles) {
		if (!filePaths.includes(requiredFile)) {
			issues.push(`${expected.name} tarball is missing ${requiredFile}.`);
		}
	}

	for (const filePath of filePaths) {
		if (filePath.startsWith('/') || filePath.split('/').includes('..')) {
			issues.push(`${expected.name} tarball contains unsafe path "${filePath}".`);
		}

		if (/(^|\/)(tests|coverage|node_modules|\.github)(\/|$)/.test(filePath)) {
			issues.push(`${expected.name} tarball contains repository-only path "${filePath}".`);
		}

		if (/(^|\/)\.env(?:\.|$)/.test(filePath) || /(^|\/)package-lock\.json$/.test(filePath)) {
			issues.push(`${expected.name} tarball contains sensitive or repository-only file "${filePath}".`);
		}

		if (filePath.endsWith('.map') || /(^|\/)tsconfig(?:\.[^/]*)?\.json$/.test(filePath)) {
			issues.push(`${expected.name} tarball contains build-only file "${filePath}".`);
		}
	}

	if (issues.length > 0) {
		throw new Error(formatReleaseIssues(`Unsafe npm pack result for ${expected.name}`, issues));
	}
}

/**
 * Formats release-policy failures into one actionable command error.
 *
 * @param {string} heading - Error summary.
 * @param {string[]} issues - Individual policy failures.
 * @returns {string} Multiline error message.
 */
export function formatReleaseIssues(heading, issues) {
	return `${heading}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`;
}

/**
 * Adds package-specific manifest failures to an aggregate issue list.
 *
 * @param {string[]} issues - Aggregate issue list to update.
 * @param {{ directory: string, name: string }} definition - Expected package identity.
 * @param {{ manifest: Record<string, any>, licensePresent: boolean }} stagedPackage - Staged package metadata.
 * @param {string} version - Expected lockstep version.
 * @param {string | null} repositoryUrl - Expected public source URL.
 * @returns {void}
 */
function collectPackageManifestIssues(issues, definition, stagedPackage, version, repositoryUrl) {
	const manifest = stagedPackage.manifest;
	const label = definition.name;

	if (manifest.name !== definition.name) issues.push(`${label} has unexpected package name "${String(manifest.name)}".`);
	if (manifest.version !== version) issues.push(`${label} must use lockstep version ${version}.`);
	if (manifest.private !== undefined) issues.push(`${label} must not contain the private field.`);
	if (typeof manifest.description !== 'string' || manifest.description.trim() === '') issues.push(`${label} must have a package description.`);
	if (typeof manifest.license !== 'string' || manifest.license.trim() === '') issues.push(`${label} must declare the selected SPDX license identifier.`);
	if (!stagedPackage.licensePresent) issues.push(`${label} must include the repository LICENSE file.`);
	if (manifest.publishConfig?.access !== 'public') issues.push(`${label} publishConfig.access must be public.`);
	if (manifest.publishConfig?.registry !== NPM_REGISTRY) issues.push(`${label} publishConfig.registry must be ${NPM_REGISTRY}.`);
	if (manifest.publishConfig?.provenance !== true) issues.push(`${label} publishConfig.provenance must be true.`);
	if (manifest.scripts !== undefined) issues.push(`${label} staged manifest must not contain lifecycle scripts.`);
	if (manifest.devDependencies !== undefined) issues.push(`${label} staged manifest must not contain development dependencies.`);
	if (!Array.isArray(manifest.files) || !manifest.files.includes('LICENSE')) issues.push(`${label} files must include LICENSE.`);

	if (
		manifest.repository?.type !== 'git'
		|| manifest.repository?.url !== repositoryUrl
		|| manifest.repository?.directory !== `packages/${definition.directory}`
	) {
		issues.push(`${label} repository metadata must point to ${repositoryUrl ?? 'the public repository'}#packages/${definition.directory}.`);
	}

	const nonPublicFrameworkReferences = findFrameworkPackageReferences(manifest)
		.filter((packageName) => !FRAMEWORK_RELEASE_PACKAGES.some((frameworkPackage) => frameworkPackage.name === packageName));

	if (nonPublicFrameworkReferences.length > 0) {
		issues.push(`${label} staged manifest contains non-public framework package references: ${nonPublicFrameworkReferences.join(', ')}.`);
	}
}

/**
 * Reports whether a checked-in package name identifies the expected framework unit.
 *
 * Source workspaces may use an internal scope before export, while the public
 * repository uses the final npm scope. Requiring the expected package basename
 * keeps the release policy portable without trusting one private namespace.
 *
 * @param {unknown} packageName - Checked-in package name to validate.
 * @param {string} directory - Framework package directory and required basename.
 * @returns {packageName is string} True for a valid scoped source package name.
 */
function isSourceFrameworkPackageName(packageName, directory) {
	return typeof packageName === 'string'
		&& new RegExp(`^@[a-z0-9][a-z0-9._-]*/${directory}$`).test(packageName);
}

/**
 * Finds scoped App and Pure package references anywhere in a staged manifest.
 *
 * @param {Record<string, any>} manifest - Staged package manifest.
 * @returns {string[]} Unique framework package references found in the manifest.
 */
function findFrameworkPackageReferences(manifest) {
	const matches = JSON.stringify(manifest).match(/@[a-z0-9][a-z0-9._-]*\/(?:app|pure)\b/g) ?? [];

	return [...new Set(matches)];
}

/**
 * Reports whether a changelog contains one dated heading for a release.
 *
 * @param {string} changelog - Changelog Markdown.
 * @param {string} version - Release version to find.
 * @returns {boolean} True when a dated release heading exists.
 */
function changelogContainsRelease(changelog, version) {
	const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const releaseHeading = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, 'm');
	const match = changelog.match(releaseHeading);

	if (!match) return false;

	const date = new Date(`${match[1]}T00:00:00.000Z`);

	return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1];
}
