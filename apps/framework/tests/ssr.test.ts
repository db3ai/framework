import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { createDocsServer, registerDocsSecurityHeaders } from '../server/createDocsServer';
import { docArticles } from '../client/docs';
import { articleSections, articleReferencePath } from '../client/articleContent';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));

test('the docs server renders canonical, hydratable pages and a noindex 404', async context => {
	const server = await createDocsServer({
		root: docsRoot,
		mode: 'development',
		logger: false,
		origin: 'https://db3.ai',
	});

	context.after(async () => {
		await server.close();
	});

	const health = await server.inject({ method: 'GET', url: '/framework/healthz' });
	const browserHealth = await server.inject({ method: 'GET', url: '/framework/healthz', headers: { 'sec-fetch-mode': 'navigate' } });
	const landing = await server.inject({ method: 'GET', url: '/framework', headers: { 'x-db3-docs-origin': 'https://untrusted.example' } });
	const framework = await server.inject({ method: 'GET', url: '/framework' });
	const article = await server.inject({ method: 'GET', url: '/framework/docs/queue-overview' });
	const notes = await server.inject({ method: 'GET', url: '/framework/docs/guide-workspace-notes' });
	const activeRecord = await server.inject({ method: 'GET', url: '/framework/docs/active-record' });
	const missing = await server.inject({ method: 'GET', url: '/framework/docs/not-a-framework-page' });

	assert.equal(health.statusCode, 200);
	assert.deepEqual(health.json(), { status: 'ready' });
	assert.equal(health.body, JSON.stringify(health.json()));
	assert.equal(browserHealth.body, JSON.stringify(browserHealth.json(), null, 2));
	assert.equal(health.headers['cache-control'], 'no-store');

	assert.equal(landing.statusCode, 200);
	assert.match(landing.body, /<title>db3\.ai Framework Documentation<\/title>/);
	assert.match(landing.body, /<link rel="canonical" href="https:\/\/db3\.ai\/framework">/);
	assert.match(landing.body, /The TypeScript framework for apps with AI\./);
	assert.doesNotMatch(landing.body, /Put AI to work/);
	assert.equal(framework.statusCode, 200);
	assert.match(framework.body, /<link rel="canonical" href="https:\/\/db3\.ai\/framework">/);
	assert.match(framework.body, /The TypeScript framework for apps with AI\./);
	assert.match(landing.body, /id="platform-ssr-state" type="application\/json">\{"location":"\/framework"\}<\/script>/);
	assert.match(landing.body, /src="\/framework\/client\/entry-client\.ts"/);
	assert.equal(landing.headers['cross-origin-opener-policy'], 'same-origin');
	assert.equal(landing.headers['cross-origin-resource-policy'], 'same-origin');
	assert.equal(landing.headers['permissions-policy'], 'camera=(), geolocation=(), microphone=()');
	assert.equal(landing.headers['referrer-policy'], 'strict-origin-when-cross-origin');
	assert.equal(landing.headers['x-content-type-options'], 'nosniff');
	assert.equal(landing.headers['x-frame-options'], 'DENY');

	assert.equal(article.statusCode, 200);
	assert.match(article.body, /<link rel="canonical" href="https:\/\/db3\.ai\/framework\/docs\/queue-overview">/);
	assert.match(article.body, /<h1>Queue<\/h1>/);
	assert.match(article.body, /href="\/framework\/docs\/scheduler" data-docs-navigation/);
	assert.equal(notes.statusCode, 200);
	assert.match(notes.body, /Copy repository test/);
	assert.match(notes.body, /This test command requires the framework repository/);
	assert.doesNotMatch(notes.body, /Run locally/);
	assert.equal(activeRecord.statusCode, 200);
	assert.match(activeRecord.body, /Why ActiveRecord\?/);
	assert.doesNotMatch(activeRecord.body, /A note from Steve/);
	assert.match(activeRecord.body, /ActiveRecord, built around fields/);
	assert.match(activeRecord.body, /ActiveField describes the principle here, not a separate API/);
	assert.match(activeRecord.body, /Illustrative pseudocode, not the db3.ai API/);
	assert.match(activeRecord.body, /href="\/framework\/docs\/active-record#start-here" data-docs-navigation/);
	assert.match(activeRecord.body, /<code\b[^>]*>save\(\)<\/code>/);
	assert.match(activeRecord.body, /<details\b[^>]*data-compact-contents/);
	assert.match(activeRecord.body, /<summary\b[^>]*>On this page<\/summary>/);
	assert.match(activeRecord.body, /<details\b[^>]*data-compact-contents[^>]*>[\s\S]*?href="\/framework\/docs\/active-record\.md"[\s\S]*?Read as Markdown[\s\S]*?<\/details>/);

	assert.equal(missing.statusCode, 404);
	assert.equal(missing.headers['x-robots-tag'], 'noindex, nofollow');
	assert.match(missing.body, /<meta name="robots" content="noindex, nofollow">/);
	assert.match(missing.body, /Documentation page not found/);
	assert.doesNotMatch(missing.body, /rel="canonical"/);

	for (const url of ['/framework', ...docArticles.map(item => `/framework/docs/${item.id}`), '/framework/docs/not-a-framework-page']) {
		const response = await server.inject({ method: 'GET', url });
		assert.equal(response.statusCode, url.endsWith('not-a-framework-page') ? 404 : 200, url);
		const current = docArticles.find(item => url === `/framework/docs/${item.id}`);
		if (current) {
			for (const section of articleSections(current)) {
				assert.ok(response.body.includes(`id="${section.id}"`), `${url}: missing section ${section.id}`);
				assert.ok(response.body.includes(`href="${url}#${section.id}"`), `${url}: missing contents link ${section.id}`);
			}
			for (const sample of current.codeSamples ?? []) {
				assert.ok(readableText(response.body).includes(readableText(sample.code, false)), `${url}: hidden example ${sample.id}`);
			}
			const reference = articleReferencePath(current);
			if (reference) assert.ok(response.body.includes(`href="${reference}"`));
		}
		if (url !== '/') assert.doesNotMatch(response.body, /growthscout/i, `${url} keeps company products outside framework documentation`);
		const text = response.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
		assert.equal(/not create-app|maintenance gate|Guidance for AI tools|Migrate small leaf services|independent guide-following review|The public package name does not rename|before being presented as available/i.test(text), false, `${url} must contain only reader-facing documentation`);
	}
});

test('production responses allow Shiki modules and WebAssembly while retaining other content restrictions', async context => {
	const server = Fastify({ logger: false });
	registerDocsSecurityHeaders(server, 'production');
	server.get('/', async () => ({ status: 'ready' }));

	context.after(async () => {
		await server.close();
	});

	const response = await server.inject({ method: 'GET', url: '/' });

	assert.equal(response.statusCode, 200);
	assert.match(response.headers['content-security-policy'] ?? '', /default-src 'self'/);
	assert.match(response.headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
	const directives = new Map((response.headers['content-security-policy'] ?? '').split('; ').map(directive => {
		const [name, ...sources] = directive.split(' ');
		return [name, sources];
	}));
	assert.deepEqual(directives.get('script-src'), ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", 'https://esm.sh']);
	assert.deepEqual(directives.get('connect-src'), ["'self'"]);
	assert.deepEqual(directives.get('object-src'), ["'none'"]);
	assert.equal(response.headers['strict-transport-security'], 'max-age=31536000');
});

test('local development serves Vite assets for the explicit db3 hostname only', async context => {
	const server = await createDocsServer({
		root: docsRoot,
		mode: 'development',
		logger: false,
		origin: 'https://local.db3.ai',
	});

	context.after(async () => {
		await server.close();
	});

	const client = await server.inject({ method: 'GET', url: '/framework/@vite/client', headers: { host: 'local.db3.ai' } });
	const entry = await server.inject({ method: 'GET', url: '/framework/client/entry-client.ts', headers: { host: 'local.db3.ai' } });
	const rejected = await server.inject({ method: 'GET', url: '/framework/@vite/client', headers: { host: 'untrusted.example' } });
	const article = await server.inject({ method: 'GET', url: '/framework/docs/welcome.md', headers: { host: 'local.db3.ai' } });
	const rendered = await server.inject({ method: 'GET', url: '/framework/docs/welcome', headers: { host: 'local.db3.ai', 'x-db3-docs-origin': 'https://untrusted.example' } });

	assert.equal(client.statusCode, 200);
	assert.match(client.headers['content-type'] ?? '', /javascript/);
	assert.equal(entry.statusCode, 200);
	assert.match(entry.headers['content-type'] ?? '', /javascript/);
	assert.equal(rejected.statusCode, 403);
	assert.equal(article.statusCode, 200);
	assert.equal(article.headers.link, '<https://local.db3.ai/framework/docs/welcome>; rel="canonical"');
	assert.equal(rendered.statusCode, 200);
	assert.match(rendered.body, /<link rel="canonical" href="https:\/\/local\.db3\.ai\/framework\/docs\/welcome">/);
	assert.doesNotMatch(rendered.body, /https:\/\/untrusted\.example/);
});

/** Normalizes rendered text without treating code's literal angle brackets as markup. */
function readableText(value: string, html = true): string {
	if (!html) return value.replace(/\s+/g, ' ').trim();
	const text = value.replace(/<[^>]*>/g, '');
	return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
