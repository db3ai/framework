import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { releaseIdentity, verifyReleaseSource } from '../check-github-framework-release.mjs';
import { readPublishedPackage, verifyPublishedTarball } from '../lib/published-framework.mjs';

/** Builds the same public event shape GitHub sends on release publication. */
function event(version = '0.1.0-beta.5') {
	return { action: 'published', repository: { full_name: 'db3ai/framework', private: false, default_branch: 'main' }, release: { draft: false, prerelease: version.includes('-'), tag_name: `framework-v${version}` } };
}

/** Confirms channel selection and stable release-line ownership. */
test('release versions select next or the matching stable maintenance line', () => {
	assert.deepEqual(releaseIdentity(event(), 'release'), { version: '0.1.0-beta.5', tag: 'framework-v0.1.0-beta.5', channel: 'next', dryRun: false, branch: 'main' });
	assert.equal(releaseIdentity(event('0.1.2'), 'release').branch, '0.1.x');
	assert.equal(releaseIdentity(event('1.2.3'), 'release').branch, '1.x');
	assert.equal(releaseIdentity(event('1.2.3'), 'release').channel, 'latest');
	assert.equal(releaseIdentity({ ...event(), inputs: { tag: 'framework-v0.1.0-beta.5' } }, 'workflow_dispatch').dryRun, true);
});

/** Rejects draft, mismatched, foreign and shell-shaped release events. */
test('untrusted release contexts cannot reach publication', () => {
	for (const change of [
		value => { value.action = 'edited'; },
		value => { value.release.draft = true; },
		value => { value.release.prerelease = false; },
		value => { value.repository.private = true; },
		value => { value.repository.full_name = 'other/framework'; },
		value => { value.release.tag_name = 'framework-v1.0.0\nINJECT=true'; },
	]) {
		const value = event();
		change(value);
		assert.throws(() => releaseIdentity(value, 'release'));
	}
	assert.throws(() => releaseIdentity(event(), 'push'));
});

/** Exercises real Git refs, ancestry and changelog guards in a disposable repository. */
test('only annotated tags at HEAD on the allowed release line pass', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-release-git-'));
	try {
		git(root, ['init', '--initial-branch=main']);
		git(root, ['config', 'user.email', 'release-test@example.test']);
		git(root, ['config', 'user.name', 'Release test']);
		await writeFile(join(root, 'CHANGELOG.md'), '## [0.1.0-beta.5] - 2026-10-11\n## [1.2.3] - 2026-10-11\n');
		git(root, ['add', '.']);
		git(root, ['commit', '-m', 'Release fixture']);
		const revision = git(root, ['rev-parse', 'HEAD']);
		git(root, ['update-ref', 'refs/remotes/origin/main', revision]);
		const identity = releaseIdentity(event(), 'release');
		git(root, ['tag', identity.tag]);
		await assert.rejects(verifyReleaseSource(root, identity), /annotated/);
		git(root, ['tag', '-d', identity.tag]);
		git(root, ['tag', '-a', identity.tag, '-m', 'Candidate']);
		assert.equal(await verifyReleaseSource(root, identity), revision);
		git(root, ['tag', '-a', 'framework-v1.2.3', '-m', 'Stable']);
		await assert.rejects(verifyReleaseSource(root, releaseIdentity(event('1.2.3'), 'release')), /Git check failed/);
		git(root, ['update-ref', 'refs/remotes/origin/1.x', revision]);
		assert.equal(await verifyReleaseSource(root, releaseIdentity(event('1.2.3'), 'release')), revision);
		await writeFile(join(root, 'CHANGELOG.md'), '# Missing release\n');
		await assert.rejects(verifyReleaseSource(root, identity), /dated changelog/);
		git(root, ['add', '.']);
		git(root, ['commit', '-m', 'Different HEAD']);
		await assert.rejects(verifyReleaseSource(root, identity), /checkout/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/** Makes infrastructure failures fail closed while permitting absent new versions. */
test('registry reads distinguish absence from errors and wrong package identities', async () => {
	assert.equal(await readPublishedPackage('@db3.ai/app', '1.2.3', async () => new Response('', { status: 404 })), null);
	await assert.rejects(readPublishedPackage('@db3.ai/app', '1.2.3', async () => new Response('', { status: 503 })), /503/);
	await assert.rejects(readPublishedPackage('@db3.ai/app', '1.2.3', async () => Response.json({ name: 'wrong' })), /Invalid registry identity/);
	await assert.rejects(readPublishedPackage('@db3.ai/app', '1.2.3', async () => Response.json({ name: '@db3.ai/app', version: '1.2.3', dist: { integrity: 'sha512-test', tarball: 'https://untrusted.example/app.tgz' } })), /origin/);
});

/** Confirms downloads match registry integrity and catches unavailable/corrupt archives. */
test('public artifact verification checks the actual archive bytes', async () => {
	const body = 'fixture tarball';
	const published = { tarball: 'https://registry.npmjs.org/fixture.tgz', integrity: `sha512-${createHash('sha512').update(body).digest('base64')}` };
	assert.equal(await verifyPublishedTarball(published, async () => new Response('', { status: 404 })), false);
	assert.equal(await verifyPublishedTarball(published, async () => new Response(body)), true);
	await assert.rejects(verifyPublishedTarball(published, async () => new Response('different bytes')), /integrity mismatch/);
});

/** Protects the workflow's credential boundary and automatic-release trigger. */
test('only the post-verification release job receives OIDC publishing permission', async () => {
	const workflow = await readFile(new URL('../../.github/workflows/framework-publish.yml', import.meta.url), 'utf8');
	const [verification, publication] = workflow.split('\n  publish:\n');
	assert.match(verification, /release:\n    types: \[published\]/);
	assert.doesNotMatch(verification, /id-token: write/);
	assert.match(publication, /needs: verify/);
	assert.match(publication, /github.event_name == 'release'/);
	assert.match(publication, /environment: npm-production/);
	assert.match(publication, /id-token: write/);
	assert.match(publication, /ref: \$\{\{ needs.verify.outputs.revision \}\}/);
	assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
});

/** Runs fixture-only Git operations without invoking a shell. */
function git(root, args) {
	const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}
