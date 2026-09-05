import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { fastifyViteSsr } from '../vite';

const servers: FastifyInstance[] = [];
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map(server => server.close()));
	await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('fastifyViteSsr', () => {
	it('loads transformed templates and hot server entries through Vite in development', async () => {
		const root = await applicationRoot();
		await writeFile(join(root, 'index.html'), documentTemplate('<link rel="stylesheet" href="/src/site.css">'));
		await writeFile(join(root, 'src', 'site.css'), 'main { color: rebeccapurple; }');
		await writeFile(join(root, 'src', 'entry-server.ts'), [
			'export async function render(context) {',
			"\tcontext.head.title = 'Development blog';",
			"\treturn { appHtml: `<main>${context.request.url}</main>` };",
			'}',
		].join('\n'));
		const server = testServer();

		await server.register(fastifyViteSsr({
			root,
			mode: 'development',
			routes: ['/blog', '/blog/*'],
			manifest: false,
		}));

		const response = await server.inject({ method: 'GET', url: '/blog/vite' });
		const styleResponse = await server.inject({ method: 'GET', url: '/src/site.css' });
		const viteClientResponse = await server.inject({ method: 'GET', url: '/@vite/client' });

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('<title>Development blog</title>');
		expect(response.body).toContain('<main>/blog/vite</main>');
		expect(styleResponse.statusCode).toBe(200);
		expect(styleResponse.body).toContain('color: rebeccapurple');
		expect(viteClientResponse.statusCode).toBe(200);
	});

	it('uses an isolated Vite configuration for an SSR page build', async () => {
		const root = await applicationRoot();
		await writeFile(join(root, 'marketing.html'), documentTemplate('<link rel="stylesheet" href="/src/marketing.css">'));
		await writeFile(join(root, 'src', 'marketing.css'), 'main { color: var(--marketing-colour); }');
		await writeFile(join(root, 'src', 'entry-marketing.ts'), [
			'export async function render() {',
			"\treturn { appHtml: '<main>Isolated build</main>' };",
			'}',
		].join('\n'));
		await writeFile(join(root, 'vite.marketing.config.ts'), [
			'export default {',
			"\tdefine: { '__MARKETING_BUILD__': JSON.stringify(true) },",
			'};',
		].join('\n'));
		const server = testServer();

		await server.register(fastifyViteSsr({
			root,
			mode: 'development',
			routes: ['/blog'],
			viteConfigFile: 'vite.marketing.config.ts',
			template: 'marketing.html',
			developmentEntry: '/src/entry-marketing.ts',
			manifest: false,
		}));

		const response = await server.inject({ method: 'GET', url: '/blog' });
		const styleResponse = await server.inject({ method: 'GET', url: '/src/marketing.css' });

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('<main>Isolated build</main>');
		expect(response.body).toContain('/src/marketing.css');
		expect(styleResponse.statusCode).toBe(200);
	});

	it('loads immutable production artifacts, manifest styles, and static assets', async () => {
		const root = await applicationRoot();
		await mkdir(join(root, 'dist', 'client', '.vite'), { recursive: true });
		await mkdir(join(root, 'dist', 'client', 'site-assets'), { recursive: true });
		await mkdir(join(root, 'dist', 'server'), { recursive: true });
		await writeFile(join(root, 'dist', 'client', 'index.html'), documentTemplate());
		await writeFile(join(root, 'dist', 'client', 'site-assets', 'site.css'), 'main { color: green; }');
		await writeFile(join(root, 'dist', 'client', '.vite', 'ssr-manifest.json'), JSON.stringify({
			'/src/pages/Blog.vue': [
				'site-assets/site.css',
				'site-assets/site.js',
			],
		}));
		await writeFile(join(root, 'dist', 'server', 'entry-server.mjs'), [
			'export async function render(context) {',
			"\tcontext.modules.add('/src/pages/Blog.vue');",
			"\tcontext.head.title = 'Production blog';",
			"\treturn { appHtml: '<main>Built article</main>' };",
			'}',
		].join('\n'));
		const server = testServer();

		await server.register(fastifyViteSsr({
			root,
			mode: 'production',
			routes: ['/blog', '/blog/*'],
			serverEntry: 'dist/server/entry-server.mjs',
			preloadJavaScript: false,
			staticAssets: {
				prefix: '/site-assets/',
				directory: 'dist/client/site-assets',
			},
		}));

		const response = await server.inject({ method: 'GET', url: '/blog' });
		const assetResponse = await server.inject({ method: 'GET', url: '/site-assets/site.css' });
		const spaResponse = await server.inject({ method: 'GET', url: '/app/dashboard' });

		expect(response.statusCode).toBe(200);
		expect(response.body).toContain('<title>Production blog</title>');
		expect(response.body).toContain('<link rel="stylesheet" href="/site-assets/site.css">');
		expect(response.body).not.toContain('site.js');
		expect(assetResponse.statusCode).toBe(200);
		expect(assetResponse.body).toContain('color: green');
		expect(spaResponse.statusCode).toBe(404);
	});
});

/**
 * Creates an isolated temporary Vite application directory.
 *
 * @returns Absolute application root with an empty source directory.
 */
async function applicationRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'platform-vite-ssr-'));
	roots.push(root);
	await mkdir(join(root, 'src'), { recursive: true });

	return root;
}

/**
 * Creates a tracked Fastify server for one adapter test.
 *
 * @returns Fastify server with a deterministic JSON not-found boundary.
 */
function testServer(): FastifyInstance {
	const server = Fastify({ logger: false });
	servers.push(server);
	server.setNotFoundHandler((_request, reply) => {
		reply.status(404).send({ error: 'not_found' });
	});

	return server;
}

/**
 * Returns the platform SSR document markers used by fixture applications.
 *
 * @returns Complete HTML template ready for Vite transformation.
 */
function documentTemplate(head = ''): string {
	return `<!doctype html><html><head>${head}<!--platform-ssr-head--></head><body><div id="app"><!--platform-ssr-app--></div></body></html>`;
}
