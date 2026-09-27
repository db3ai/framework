import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { parsePublishArguments, publishPackageDirectories, setPublicationVersion } from '../publish-framework.mjs';

const VERSION = '0.1.0-beta.1';

/** Verifies a maintainer explicitly chooses the version and beta distribution tag. */
test('publication requires a version and keeps prereleases off latest', () => {
	assert.deepEqual(parsePublishArguments(['--version', VERSION]), { version: VERSION, tag: 'next', dryRun: false, from: 'pure' });
	assert.deepEqual(parsePublishArguments(['--version', VERSION, '--dry-run']), { version: VERSION, tag: 'next', dryRun: true, from: 'pure' });
	assert.equal(parsePublishArguments(['--version', VERSION, '--from', 'app']).from, 'app');
	assert.throws(() => parsePublishArguments(['--version', VERSION, '--from', 'unrelated']));
	assert.equal(parsePublishArguments(['--version', '1.0.0']).tag, 'latest');
	assert.equal(parsePublishArguments(['--version', VERSION, '--tag', 'beta']).tag, 'beta');
	for (const args of [[], ['--version', 'invalid'], ['--version'], ['--version', VERSION, '--tag'], ['--version', VERSION, '--tag', 'latest'], ['--version', VERSION, '--dry-run=false']]) {
		assert.throws(() => parsePublishArguments(args));
	}
});

/** Checks release versions and dependency pins without changing the app's own version. */
test('compiled packages and generated app use the selected lockstep version', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-publish-version-'));
	try {
		for (const directory of ['pure', 'app', 'create', 'create/template']) {
			await mkdir(join(root, directory), { recursive: true });
			await writeFile(join(root, directory, 'package.json'), JSON.stringify({ name: directory === 'create/template' ? 'db3-starter' : `@db3.ai/${directory}`, version: '0.1.0', dependencies: { '@db3.ai/pure': '0.1.0', '@db3.ai/app': '0.1.0' } }));
		}
		await setPublicationVersion(root, VERSION);
		for (const directory of ['pure', 'app', 'create']) {
			assert.equal(JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8')).version, VERSION);
		}
		assert.equal(JSON.parse(await readFile(join(root, 'app/package.json'), 'utf8')).dependencies['@db3.ai/pure'], VERSION);
		const starter = JSON.parse(await readFile(join(root, 'create/template/package.json'), 'utf8'));
		assert.equal(starter.dependencies['@db3.ai/app'], VERSION);
		assert.equal(starter.version, '0.1.0');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

/** Ensures every package is inspected before any npm publish and flags apply to all. */
test('npm publishes package directories in dependency order after all inspections', () => {
	for (const dryRun of [false, true]) {
		const calls = [];
		publishPackageDirectories('/release', { version: VERSION, tag: 'next', dryRun }, (executable, args, cwd) => {
			calls.push({ executable, args, cwd });
			return inspection(basename(cwd));
		});
		assert.deepEqual(calls.map(call => `${call.args[0]}:${basename(call.cwd)}`), ['pack:pure', 'pack:app', 'pack:create', 'publish:pure', 'publish:app', 'publish:create']);
		for (const call of calls.slice(3)) {
			assert.equal(call.args.includes('--dry-run'), dryRun);
			assert.ok(call.args.includes('--ignore-scripts'));
			assert.ok(call.args.includes('--provenance=false'));
			assert.ok(call.args.includes('--access=public'));
			assert.ok(call.args.includes('--tag=next'));
			assert.equal(call.args.some(argument => argument.endsWith('.tgz')), false);
		}
	}
});

/** Prevents a late package inspection failure from creating a partial release. */
test('invalid creator contents prevent publication of every package', () => {
	let publishes = 0;
	assert.throws(() => publishPackageDirectories('/release', { version: VERSION, tag: 'next', dryRun: false }, (executable, args, cwd) => {
		if (args[0] === 'publish') publishes += 1;
		return basename(cwd) === 'create' ? JSON.stringify([{ name: '@db3.ai/create', version: VERSION, files: [] }]) : inspection(basename(cwd));
	}), /missing/);
	assert.equal(publishes, 0);
});

/** Allows a maintainer to resume a partial release after checking registry state. */
test('resuming at App inspects all packages and publishes only App and Create', () => {
	const published = [];
	const inspected = [];
	publishPackageDirectories('/release', { version: VERSION, tag: 'next', dryRun: true, from: 'app' }, (executable, args, cwd) => {
		(args[0] === 'publish' ? published : inspected).push(basename(cwd));
		return inspection(basename(cwd));
	});
	assert.deepEqual(inspected, ['pure', 'app', 'create']);
	assert.deepEqual(published, ['app', 'create']);
});

/** Stops dependency publication after npm reports an error without automatic retries. */
test('an npm publication failure stops subsequent packages', () => {
	const published = [];
	assert.throws(() => publishPackageDirectories('/release', { version: VERSION, tag: 'next', dryRun: false }, (executable, args, cwd) => {
		if (args[0] === 'publish') {
			published.push(basename(cwd));
			if (basename(cwd) === 'app') throw new Error('npm authentication failed');
		}
		return inspection(basename(cwd));
	}), /npm authentication failed/);
	assert.deepEqual(published, ['pure', 'app']);
});

/**
 * Supplies the external npm CLI's inspection response for process-boundary tests.
 *
 * @param {string} directory - Framework package directory name.
 * @returns {string} npm pack JSON containing the required public package files.
 */
function inspection(directory) {
	const paths = ['package.json', 'README.md', 'LICENSE', ...(directory === 'create' ? ['bin/create.mjs', 'src/createProject.mjs', 'template/package.json', 'template/.env.example', 'template/server/app.ts', 'template/tests/app.test.ts'] : ['dist/index.js', 'dist/index.d.ts'])];
	return JSON.stringify([{ name: `@db3.ai/${directory}`, version: VERSION, files: paths.map(path => ({ path })) }]);
}
