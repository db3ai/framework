import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { SSR_APP_MARKER, SSR_HEAD_MARKER, SSR_STATE_MARKER } from '..';
import { fastifySsr } from '../fastify';
import type { FastifySsrOptions } from '../fastify';

const template = `<!doctype html><html><head>${SSR_HEAD_MARKER}</head><body><div id="app">${SSR_APP_MARKER}</div><script type="application/json">${SSR_STATE_MARKER}</script></body></html>`;
const servers: FastifyInstance[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

/**
 * Creates a tracked Fastify test server with the SSR plugin registered.
 *
 * @param options - SSR plugin options under test.
 * @returns Fastify server ready for request injection.
 */
async function createServer(options: FastifySsrOptions): Promise<FastifyInstance> {
	const server = Fastify({ logger: false });
	servers.push(server);
	await server.register(fastifySsr(options));

	return server;
}

describe('fastifySsr', () => {
	it('renders root and nested GET requests through an isolated SSR context', async () => {
		const server = await createServer({
			template: async (request) => {
				expect(request.headers['x-site']).toBe('example-app');
				return template;
			},
			render: async (context) => {
				context.status = 203;
				context.head.title = `Rendered ${context.request.url}`;
				context.state.requestUrl = context.request.url;

				return {
					appHtml: `<main>${context.request.method} ${context.request.url}</main>`,
					headers: {
						'x-platform-render': 'ssr',
					},
				};
			},
		});

		const rootResponse = await server.inject({
			method: 'GET',
			url: '/',
			headers: { 'x-site': 'example-app' },
		});
		const articleResponse = await server.inject({
			method: 'GET',
			url: '/blog/ctr?source=dashboard',
			headers: { 'x-site': 'example-app' },
		});
		const headResponse = await server.inject({
			method: 'HEAD',
			url: '/blog/ctr',
			headers: { 'x-site': 'example-app' },
		});

		expect(rootResponse.statusCode).toBe(203);
		expect(rootResponse.headers['content-type']).toContain('text/html');
		expect(rootResponse.headers['x-platform-render']).toBe('ssr');
		expect(rootResponse.body).toContain('<main>GET /</main>');
		expect(articleResponse.body).toContain('<title>Rendered /blog/ctr?source=dashboard</title>');
		expect(articleResponse.body).toContain('"requestUrl":"/blog/ctr?source=dashboard"');
		expect(headResponse.statusCode).toBe(203);
		expect(headResponse.headers['content-type']).toContain('text/html');
		expect(headResponse.body).toBe('');
	});

	it('preserves specific Fastify routes and excluded not-found boundaries', async () => {
		const server = Fastify({ logger: false });
		servers.push(server);
		server.get('/api/health', async () => ({ ok: true }));
		server.setNotFoundHandler((_request, reply) => {
			reply.status(404).send({ error: 'not_found' });
		});
		await server.register(fastifySsr({
			template,
			shouldRender: (request) => {
				const path = request.url.split('?')[0];
				return path !== '/api' && !path.startsWith('/api/');
			},
			render: async () => ({ appHtml: '<main>Marketing page</main>' }),
		}));

		const healthResponse = await server.inject({ method: 'GET', url: '/api/health' });
		const apiRootResponse = await server.inject({ method: 'GET', url: '/api?source=browser' });
		const missingApiResponse = await server.inject({ method: 'GET', url: '/api/missing' });
		const postResponse = await server.inject({ method: 'POST', url: '/blog/ctr' });

		expect(healthResponse.json()).toEqual({ ok: true });
		expect(apiRootResponse.statusCode).toBe(404);
		expect(apiRootResponse.json()).toEqual({ error: 'not_found' });
		expect(missingApiResponse.statusCode).toBe(404);
		expect(missingApiResponse.json()).toEqual({ error: 'not_found' });
		expect(postResponse.statusCode).toBe(404);
	});

	it('renders only the explicit page routes owned by the adapter', async () => {
		const server = Fastify({ logger: false });
		servers.push(server);
		server.setNotFoundHandler((_request, reply) => {
			reply.status(404).send({ error: 'not_found' });
		});
		await server.register(fastifySsr({
			template,
			routes: ['/blog', '/blog/*'],
			render: async context => ({
				appHtml: `<main>${context.request.url}</main>`,
			}),
		}));

		const blogResponse = await server.inject({ method: 'GET', url: '/blog' });
		const articleResponse = await server.inject({ method: 'GET', url: '/blog/ctr' });
		const homepageResponse = await server.inject({ method: 'GET', url: '/' });
		const appResponse = await server.inject({ method: 'GET', url: '/app/dashboard' });

		expect(blogResponse.body).toContain('<main>/blog</main>');
		expect(articleResponse.body).toContain('<main>/blog/ctr</main>');
		expect(homepageResponse.statusCode).toBe(404);
		expect(appResponse.statusCode).toBe(404);
	});

	it('does not leak mutable render state across concurrent requests', async () => {
		const server = await createServer({
			template,
			render: async (context) => {
				context.state.url = context.request.url;
				context.head.title = context.request.url;
				await new Promise((resolve) => setTimeout(resolve, context.request.url === '/first' ? 10 : 0));

				return {
					appHtml: `<main>${context.state.url}</main>`,
				};
			},
		});

		const [firstResponse, secondResponse] = await Promise.all([
			server.inject({ method: 'GET', url: '/first' }),
			server.inject({ method: 'GET', url: '/second' }),
		]);

		expect(firstResponse.body).toContain('<title>/first</title>');
		expect(firstResponse.body).toContain('<main>/first</main>');
		expect(firstResponse.body).toContain('"url":"/first"');
		expect(firstResponse.body).not.toContain('/second');
		expect(secondResponse.body).toContain('<title>/second</title>');
		expect(secondResponse.body).toContain('<main>/second</main>');
		expect(secondResponse.body).toContain('"url":"/second"');
		expect(secondResponse.body).not.toContain('/first');
	});

	it('keeps render failures inside a private plain-text error boundary', async () => {
		const server = await createServer({
			template,
			render: async () => {
				throw new Error('Private database and stack details.');
			},
		});

		const response = await server.inject({ method: 'GET', url: '/broken' });

		expect(response.statusCode).toBe(500);
		expect(response.headers['content-type']).toContain('text/plain');
		expect(response.body).toBe('Internal Server Error');
		expect(response.body).not.toContain('Private database');
	});
});
