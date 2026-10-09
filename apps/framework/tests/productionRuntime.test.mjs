import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDocsServer } from '../dist/runtime/index.js';

/**
 * Exercises built SSR with the same entry point and dependencies as production.
 *
 * The image runs this test after installing its isolated runtime lockfile, so an
 * accidental import of a build-only framework dependency fails before promotion.
 */
test('the production runtime serves health, canonical feature documentation and unknown routes', async context => {
	const previousRevision = process.env.DOCS_RELEASE_REVISION;
	process.env.DOCS_RELEASE_REVISION = 'verified-docs-revision';
	context.after(() => { if (previousRevision === undefined) delete process.env.DOCS_RELEASE_REVISION; else process.env.DOCS_RELEASE_REVISION = previousRevision; });
	const server = await createDocsServer({ root: fileURLToPath(new URL('..', import.meta.url)), mode: 'production', logger: false, origin: 'https://db3.ai' });
	/** Releases the real SSR host after success or assertion failure. */
	context.after(async () => { await server.close(); });
	const health = await server.inject('/framework/healthz');
	assert.equal(health.statusCode, 200);
	assert.deepEqual(health.json(), { status: 'ready', revision: 'verified-docs-revision' });
	const guide = await server.inject('/framework/docs/apps');
	assert.equal(guide.statusCode, 200);
	assert.match(guide.body, /Create a feature app/);
	assert.match(guide.body, /<link rel="canonical" href="https:\/\/db3\.ai\/framework\/docs\/apps">/);
	const asset = guide.body.match(/src="(\/framework\/assets\/[^" ]+\.js)"/)?.[1];
	assert.ok(asset, 'Built HTML references the framework browser bundle.');
	assert.equal((await server.inject(asset)).statusCode, 200);
	assert.equal((await server.inject('/')).statusCode, 404);
	assert.equal((await server.inject('/assets/missing.js')).statusCode, 404);
	const missing = await server.inject('/framework/docs/unknown-release-check');
	assert.equal(missing.statusCode, 404);
	assert.equal(missing.headers['x-robots-tag'], 'noindex, nofollow');
});
