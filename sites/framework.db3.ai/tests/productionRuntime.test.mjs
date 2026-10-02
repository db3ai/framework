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
	const server = await createDocsServer({ root: fileURLToPath(new URL('..', import.meta.url)), mode: 'production', logger: false, origin: 'https://framework.db3.ai' });
	/** Releases the real SSR host after success or assertion failure. */
	context.after(async () => { await server.close(); });
	const health = await server.inject('/healthz');
	assert.equal(health.statusCode, 200);
	assert.deepEqual(health.json(), { status: 'ready' });
	const guide = await server.inject('/docs/apps');
	assert.equal(guide.statusCode, 200);
	assert.match(guide.body, /Create a feature app/);
	assert.match(guide.body, /<link rel="canonical" href="https:\/\/framework\.db3\.ai\/docs\/apps">/);
	const missing = await server.inject('/docs/unknown-release-check');
	assert.equal(missing.statusCode, 404);
	assert.equal(missing.headers['x-robots-tag'], 'noindex, nofollow');
});
