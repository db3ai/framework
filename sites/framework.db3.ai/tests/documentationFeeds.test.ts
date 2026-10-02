import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerDocumentationFeeds } from '../server/registerDocumentationFeeds';

test('documentation feeds expose registry Markdown and public discovery files', async t => {
	const server = Fastify();

	t.after(async () => {
		await server.close();
	});
	registerDocumentationFeeds(server, { origin: 'https://preview.db3.ai' });

	const [llms, full, article, sitemap, robots, missing] = await Promise.all([
		server.inject('/llms.txt'),
		server.inject('/llms-full.txt'),
		server.inject('/docs/queue-overview.md'),
		server.inject('/sitemap.xml'),
		server.inject('/robots.txt'),
		server.inject('/docs/not-a-real-article.md'),
	]);

	assert.equal(llms.statusCode, 200);
	assert.match(llms.headers['content-type'] ?? '', /^text\/plain/);
	assert.match(llms.headers['cache-control'] ?? '', /stale-while-revalidate/);
	assert.match(llms.body, /exported TypeScript contracts/);

	assert.equal(full.statusCode, 200);
	assert.match(full.body, /complete documentation/);

	assert.equal(article.statusCode, 200);
	assert.match(article.headers['content-type'] ?? '', /^text\/markdown/);
	assert.equal(article.headers.link, '<https://preview.db3.ai/docs/queue-overview>; rel="canonical"');
	assert.match(article.body, /Behavioural verification/);

	assert.equal(sitemap.statusCode, 200);
	assert.match(sitemap.headers['content-type'] ?? '', /^application\/xml/);
	assert.match(sitemap.body, /https:\/\/preview\.db3\.ai\/docs\/queue-overview/);

	assert.equal(robots.statusCode, 200);
	assert.match(robots.body, /https:\/\/preview\.db3\.ai\/sitemap\.xml/);
	assert.equal(missing.statusCode, 404);
});

test('feed registration defaults to the canonical db3.ai origin', async t => {
	const server = testServer(t);

	registerDocumentationFeeds(server);

	const article = await server.inject('/docs/welcome.md');

	assert.equal(article.statusCode, 200);
	assert.equal(article.headers.link, '<https://framework.db3.ai/docs/welcome>; rel="canonical"');
	assert.match(article.body, /https:\/\/framework\.db3\.ai\/docs\/welcome\.md/);
});

/**
 * Creates a Fastify test server and registers deterministic teardown.
 *
 * @param context - Node test context that owns server cleanup.
 * @returns Empty Fastify server ready for route registration.
 */
function testServer(context: TestContext): FastifyInstance {
	const server = Fastify();

	context.after(async () => {
		await server.close();
	});

	return server;
}

/** Keeps supporting references accessible without silently changing a guide's contents. */
test('service references are explicit public resources and never arbitrary repository reads', async t => {
	const server = testServer(t);
	registerDocumentationFeeds(server);
	const guide = await server.inject('/docs/apps.md');
	const reference = await server.inject('/docs/apps/reference.md');
	assert.equal(guide.statusCode, 200);
	assert.match(guide.body, /Create a feature app/);
	assert.match(guide.body, /https:\/\/framework\.db3\.ai\/docs\/apps\/reference.md/);
	assert.doesNotMatch(guide.body, /# Apps: add a folder, then install/);
	assert.equal(reference.statusCode, 200);
	assert.match(reference.headers['content-type'] ?? '', /^text\/markdown/);
	assert.match(reference.body, /# Apps: add a folder, then install/);
	assert.equal((await server.inject('/docs/internal-plan/reference.md')).statusCode, 404);
});
