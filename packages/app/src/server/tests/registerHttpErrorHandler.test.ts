import { PassThrough, Writable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordNotFoundError } from '@db3.ai/app/db';
import { registerHttpErrorHandler, type HttpErrorHandlerOptions } from '@db3.ai/app/server';

const sql = "select websites.primary_seo_location from websites where organization_id = 'private-row'";
const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;

afterEach(() => vi.unstubAllEnvs());

/** Creates a realistic driver exception without connecting to an application database. */
function databaseError(): Error {
	return Object.assign(new Error(`${sql} - Unknown column 'websites.primary_seo_location'`), {
		code: 'ER_BAD_FIELD_ERROR', sql, sqlMessage: 'Unknown column', sqlState: '42S22',
		cause: new Error('private credentials'),
	});
}

describe('framework HTTP error boundary', () => {
	it.each(['production', 'staging', 'unknown', '', undefined])('hides every diagnostic in %s', async environment => {
		vi.stubEnv('NODE_ENV', environment);
		const server = Fastify();
		const records: unknown[] = [];
		registerHttpErrorHandler(server, { onServerError: error => { records.push(error); } });
		const error = databaseError();
		server.get('/fail', async () => { throw error; });
		try {
			const response = await server.inject('/fail');
			expect(response.statusCode).toBe(500);
			expect(response.json()).toEqual({ error: 'server_error', message: 'Unexpected server error', reference: expect.stringMatching(ulid) });
			expect(response.headers['cache-control']).toBe('no-store');
			expect(records).toEqual([error]);
			expect(error.message).toContain(sql);
		} finally { await server.close(); }
	});

	it.each(['dev', 'develop', 'development', 'local', 'test'])('keeps diagnostic messages in %s', async environment => {
		vi.stubEnv('NODE_ENV', environment);
		const server = Fastify();
		registerHttpErrorHandler(server);
		server.get('/fail', async () => { throw databaseError(); });
		try {
			const response = await server.inject('/fail');
			expect(response.statusCode).toBe(500);
			expect(response.json().message).toContain(sql);
		} finally { await server.close(); }
	});

	it('protects awaited plugins, hooks, reply.send(Error), and child error handlers', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const records: unknown[] = [];
		const server = Fastify();
		registerHttpErrorHandler(server, { onServerError: error => { records.push(error); } });
		server.get('/early', async () => { throw databaseError(); });
		await server.register(async child => {
			child.get('/child', async () => { throw databaseError(); });
			child.get('/hook', { preHandler: async () => { throw databaseError(); } }, async () => 'never');
		});
		await server.register(async child => {
			child.setErrorHandler((error, _request, reply) => reply.code(500).send({ error, message: sql, stack: 'private stack' }));
			child.get('/override', async () => { throw databaseError(); });
		});
		await server.register(async child => {
			child.setErrorHandler((_error, _request, reply) => reply.code(400).send({ message: sql }));
			child.get('/downgraded', async () => { throw databaseError(); });
		});
		server.get('/send-error', async (_request, reply) => reply.send(databaseError()));
		try {
			for (const url of ['/early', '/child', '/hook', '/override', '/downgraded', '/send-error']) {
				const response = await server.inject(url);
				expect(response.statusCode).toBe(500);
				expect(response.json()).toEqual({ error: 'server_error', message: 'Unexpected server error', reference: expect.stringMatching(ulid) });
			}
			expect(records).toHaveLength(6);
			for (const error of records) expect(error).toMatchObject({ message: expect.stringContaining(sql) });
		} finally { await server.close(); }
	});

	it('sanitizes explicit 5xx bodies after response schemas and replaces stale response headers', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const server = Fastify();
		registerHttpErrorHandler(server);
		server.get('/json', { schema: { response: { 503: { type: 'object', properties: { message: { type: 'string' }, stack: { type: 'string', default: 'private stack' } } } } } }, async (_request, reply) => reply.code(503).send({ message: sql }));
		server.get('/html', async (_request, reply) => reply.code(502).type('text/html').header('content-length', 999).header('content-encoding', 'gzip').send(`<pre>${sql}</pre>`));
		server.get('/buffer', async (_request, reply) => reply.code(500).send(Buffer.from(sql)));
		try {
			for (const url of ['/json', '/html', '/buffer']) {
				const response = await server.inject(url);
				expect(response.statusCode).toBe(url === '/json' ? 503 : url === '/html' ? 502 : 500);
				expect(response.json()).toEqual({ error: 'server_error', message: 'Unexpected server error', reference: expect.stringMatching(ulid) });
				expect(response.headers['content-type']).toContain('application/json');
				expect(response.headers['content-encoding']).toBeUndefined();
				expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(response.body));
			}
		} finally { await server.close(); }
	});

	it('logs original SQL, driver metadata and stack exactly once, even if the support observer fails', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const records: Record<string, unknown>[] = [];
		const stream = new Writable({ write(chunk, _encoding, done) { records.push(JSON.parse(chunk.toString())); done(); } });
		const server = Fastify({ logger: { stream } });
		registerHttpErrorHandler(server, { onServerError: () => { throw new Error('private support-store error'); } });
		server.get('/fail', async () => { throw databaseError(); });
		try {
			const response = await server.inject('/fail');
			const failures = records.filter(record => record.msg === 'Request failed with server error');
			expect(failures).toHaveLength(1);
			expect(failures[0]).toMatchObject({ reference: response.json().reference, reqId: 'req-1', err: { message: expect.stringContaining(sql), stack: expect.stringContaining(sql), code: 'ER_BAD_FIELD_ERROR', sql } });
			expect(response.json().message).toBe('Unexpected server error');
			expect(response.body).not.toContain('private');
		} finally { await server.close(); stream.end(); }
	});

	it('preserves deliberate client errors and treats arbitrary provider 4xx exceptions as server failures', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const server = Fastify({ bodyLimit: 32 });
		const deliberate = new Error('Please select a website.');
		const options: HttpErrorHandlerOptions = { mapError: error => error === deliberate ? { statusCode: 422, body: { error: 'invalid_request', message: deliberate.message } } : undefined };
		registerHttpErrorHandler(server, options);
		server.get('/client', async () => { throw deliberate; });
		server.get('/missing', async () => { throw new RecordNotFoundError('Website', { secret: 'private-row' }); });
		server.get('/provider', async () => { throw Object.assign(new Error('private provider customer'), { statusCode: 400, code: 'resource_missing' }); });
		server.post('/echo', async request => request.body);
		try {
			const client = await server.inject('/client');
			expect(client.statusCode).toBe(422);
			expect(client.json()).toEqual({ error: 'invalid_request', message: deliberate.message });
			const missing = await server.inject('/missing');
			expect(missing.statusCode).toBe(404);
			expect(missing.body).not.toContain('private-row');
			const provider = await server.inject('/provider');
			expect(provider.statusCode).toBe(500);
			expect(provider.body).not.toContain('private');
			expect((await server.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(400);
			expect((await server.inject({ method: 'POST', url: '/echo', payload: { text: 'x'.repeat(100) } })).statusCode).toBe(413);
			expect((await server.inject({ method: 'POST', url: '/echo', payload: { ok: true } })).json()).toEqual({ ok: true });
		} finally { await server.close(); }
	});

	it('sanitizes stream failures before any response bytes have been sent', async () => {
		vi.stubEnv('NODE_ENV', 'production');
		const server = Fastify();
		registerHttpErrorHandler(server);
		server.get('/stream', async (_request, reply) => {
			const stream = new PassThrough();
			queueMicrotask(() => stream.destroy(databaseError()));
			return reply.type('image/webp').send(stream);
		});
		try {
			const response = await server.inject('/stream');
			expect(response.statusCode).toBe(500);
			expect(response.json().message).toBe('Unexpected server error');
		} finally { await server.close(); }
	});
});
