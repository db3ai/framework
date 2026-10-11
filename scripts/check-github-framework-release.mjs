import { appendFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFrameworkReleaseVersion } from './lib/framework-release-policy.mjs';

/**
 * Resolves the release identity without evaluating event-provided text as shell code.
 * Manual dispatch is verification-only; only a published GitHub release may publish.
 *
 * @param {object} event - GitHub event payload.
 * @param {string} eventName - GitHub event name.
 * @returns {{version: string, tag: string, channel: string, dryRun: boolean, branch: string}} Checked release identity.
 */
export function releaseIdentity(event, eventName) {
	if (event.repository?.full_name !== 'db3ai/framework' || event.repository?.private !== false) throw new Error('Releases require the public db3ai/framework repository.');
	const dryRun = eventName === 'workflow_dispatch';
	if (!dryRun && (eventName !== 'release' || event.action !== 'published' || event.release?.draft !== false)) throw new Error('Only published releases may publish packages.');
	const tag = dryRun ? event.inputs?.tag : event.release?.tag_name;
	const version = typeof tag === 'string' && tag.startsWith('framework-v') ? tag.slice('framework-v'.length) : '';
	if (!isFrameworkReleaseVersion(version)) throw new Error('Use an exact framework-v<SemVer> release tag.');
	const prerelease = version.includes('-');
	if (!dryRun && event.release.prerelease !== prerelease) throw new Error('GitHub prerelease status must match the version.');
	const [major, minor] = version.split('.');
	const branch = prerelease ? event.repository.default_branch : major === '0' ? `0.${minor}.x` : `${major}.x`;
	if (!branch) throw new Error('The release must identify its source branch.');
	return { version, tag, channel: prerelease ? 'next' : 'latest', dryRun, branch };
}

/**
 * Requires an annotated tag at HEAD, ancestry on the supported source branch, and
 * a dated changelog entry. Stable versions must belong to their maintenance line.
 *
 * @param {string} root - Checked-out public source directory.
 * @param {ReturnType<typeof releaseIdentity>} identity - Validated event identity.
 * @returns {Promise<string>} Exact verified commit SHA.
 */
export async function verifyReleaseSource(root, identity) {
	const ref = `refs/tags/${identity.tag}`;
	if (git(root, ['cat-file', '-t', ref]) !== 'tag') throw new Error('Release tags must be annotated.');
	const revision = git(root, ['rev-parse', `${ref}^{commit}`]);
	if (revision !== git(root, ['rev-parse', 'HEAD'])) throw new Error('Release tag does not match the checkout.');
	git(root, ['check-ref-format', `refs/heads/${identity.branch}`]);
	git(root, ['merge-base', '--is-ancestor', revision, `refs/remotes/origin/${identity.branch}`]);
	const changelog = await readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
	if (!changelog.split('\n').some(line => line.startsWith(`## [${identity.version}] - `) && /^\d{4}-\d{2}-\d{2}$/.test(line.split(' - ')[1]))) throw new Error('Release requires a dated changelog entry.');
	return revision;
}

/**
 * Runs a read-only Git verification without shell interpolation.
 * @param {string} root - Git checkout.
 * @param {string[]} args - Git arguments.
 * @returns {string} Trimmed Git result.
 */
function git(root, args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`Release Git check failed: ${args.join(' ')}\n${result.stderr ?? ''}`);
	return result.stdout.trim();
}

/** Reads and verifies the Actions event, then exports only validated step outputs. */
async function main() {
	const identity = releaseIdentity(JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')), process.env.GITHUB_EVENT_NAME);
	const revision = await verifyReleaseSource(process.cwd(), identity);
	if (!identity.dryRun && (process.env.GITHUB_REF !== `refs/tags/${identity.tag}` || process.env.GITHUB_SHA !== revision)) throw new Error('GitHub event ref/SHA differs from the release checkout.');
	await appendFile(process.env.GITHUB_OUTPUT, Object.entries({ ...identity, revision }).map(([key, value]) => `${key}=${value}\n`).join(''));
	console.log(`Verified ${identity.tag} at ${revision}; channel ${identity.channel}; dry-run ${identity.dryRun}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
