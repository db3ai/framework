import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Health } from '@db3.ai/app/health';
import { registerHealthRoute } from '@db3.ai/app/health/fastify';
import { registerBrowserJsonFormatting } from '@db3.ai/app/server/browser-json';
import { registerHttpErrorHandler } from '@db3.ai/app/server';

const navigation = { 'sec-fetch-mode': 'navigate', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

afterEach(() => vi.unstubAllEnvs());

describe('registerBrowserJsonFormatting', () => {
	it('formats JSON from any GET route for navigation and preserves compact API responses', async () => {
		const server = Fastify();
		registerHttpErrorHandler(server);
		registerHealthRoute(server, { app: { health: new Health({ service: 'example-api' }) } });
		server.get('/data', async (_request, reply) => reply.header('vary', 'Origin').send({ nested: { value: 1 } }));
		server.post('/data', async () => ({ nested: { value: 1 } }));

		try {
			for (const url of ['/health', '/data']) {
				const browser = await server.inject({ url, headers: navigation });
				const api = await server.inject({ url, headers: { accept: 'text/html', 'sec-fetch-mode': 'same-origin' } });
				const noMetadata = await server.inject({ url, headers: { accept: 'text/html' } });
				expect(browser.body).toBe(JSON.stringify(browser.json(), null, 2));
				expect(api.body).toBe(JSON.stringify(api.json()));
				expect(noMetadata.body).toBe(JSON.stringify(noMetadata.json()));
				expect(browser.headers['content-type']).toContain('application/json');
				expect(browser.headers.vary).toContain('Sec-Fetch-Mode');
				expect(api.headers.vary).toContain('Sec-Fetch-Mode');
			}

			const data = await server.inject({ url: '/data', headers: navigation });
			expect(data.headers.vary).toBe('Origin, Sec-Fetch-Mode');
			const post = await server.inject({ method: 'POST', url: '/data', headers: navigation });
			expect(post.body).toBe(JSON.stringify(post.json()));
			expect(post.headers.vary).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it('runs after response schemas and the production error boundary', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const server = Fastify();
		registerHttpErrorHandler(server);
		server.get('/schema', { schema: { response: { 200: { type: 'object', properties: { visible: { type: 'string' } } } } } }, async () => ({ visible: 'safe', secret: 'private' }));
		server.get('/failure', async () => { throw new Error('private failure'); });

		try {
			const schema = await server.inject({ url: '/schema', headers: navigation });
			expect(schema.body).toBe(JSON.stringify({ visible: 'safe' }, null, 2));
			const failure = await server.inject({ url: '/failure', headers: navigation });
			expect(failure.statusCode).toBe(500);
			expect(failure.body).toBe(JSON.stringify(failure.json(), null, 2));
			expect(failure.body).not.toContain('private failure');
		} finally {
			await server.close();
		}
	});

	it('preserves raw numeric and escaped string tokens while changing only spacing', async () => {
		const server = Fastify();
		registerBrowserJsonFormatting(server);
		const source = '{"id":9007199254740993,"huge":1e309,"negativeZero":-0,"text":"{, \\"escaped\\" : [ ]}"}';
		server.get('/raw', async (_request, reply) => reply.type('application/json').send(source));

		try {
			const browser = await server.inject({ url: '/raw', headers: navigation });
			const api = await server.inject('/raw');
			expect(browser.body).toBe('{\n  "id": 9007199254740993,\n  "huge": 1e309,\n  "negativeZero": -0,\n  "text": "{, \\"escaped\\" : [ ]}"\n}');
			expect(api.body).toBe(source);
		} finally {
			await server.close();
		}
	});

	it('leaves non-JSON, invalid JSON, streams, integrity-protected and large bodies alone', async () => {
		const server = Fastify();
		registerBrowserJsonFormatting(server);
		server.get('/html', async (_request, reply) => reply.type('text/html').send('<p>Hello</p>'));
		server.get('/invalid', async (_request, reply) => reply.type('application/json').send('{invalid'));
		server.get('/stream', async (_request, reply) => reply.type('application/json').send(Readable.from([JSON.stringify({ nested: { value: 1 } })])));
		server.get('/etag', async (_request, reply) => reply.header('etag', '"original"').send({ nested: { value: 1 } }));
		server.get('/large', async () => ({ text: 'x'.repeat(1_000_001) }));
		server.get('/length', async (_request, reply) => reply.header('content-length', 1).send({ nested: { value: 1 } }));

		try {
			expect((await server.inject({ url: '/html', headers: navigation })).body).toBe('<p>Hello</p>');
			expect((await server.inject({ url: '/invalid', headers: navigation })).body).toBe('{invalid');
			const stream = await server.inject({ url: '/stream', headers: navigation });
			expect(stream.body).toBe(JSON.stringify(stream.json()));
			const etag = await server.inject({ url: '/etag', headers: navigation });
			expect(etag.body).toBe(JSON.stringify(etag.json()));
			const large = await server.inject({ url: '/large', headers: navigation });
			expect(large.body).toBe(JSON.stringify(large.json()));
			const length = await server.inject({ url: '/length', headers: navigation });
			expect(length.body).toBe(JSON.stringify(length.json(), null, 2));
			expect(Number(length.headers['content-length'])).toBe(Buffer.byteLength(length.body));
		} finally {
			await server.close();
		}
	});
});
