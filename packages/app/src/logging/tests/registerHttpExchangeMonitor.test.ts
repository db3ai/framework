import { Writable } from 'node:stream';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { PinoLoggerDriver, type HttpExchangeLog } from '@db3.ai/app/logging';
import { describe, expect, it, vi } from 'vitest';

import { registerHttpExchangeMonitor } from '@db3.ai/app/logging';

describe('registerHttpExchangeMonitor', () => {

	it('captures redacted request and response data during development', async () => {
		const records: Array<Record<string, unknown>> = [];
		const driver = new PinoLoggerDriver({
			devtools: false,
			environment: 'test',
			level: 'info',
			source: 'notes-test',
		}, captureDestination(records));
		const server = Fastify({
			loggerInstance: driver.logger as FastifyBaseLogger,
		});

		server.addContentTypeParser('application/x-www-form-urlencoded', {
			parseAs: 'string',
		}, (_request, body, done) => {
			done(null, body);
		});
		registerHttpExchangeMonitor(server, {
			environment: 'development',
		});
		server.post('/sessions', async (request, reply) => {
			reply.header('set-cookie', 'session=private');
			reply.status(201);

			return {
				created: true,
				credentials: request.body,
				token: 'response-token',
			};
		});
		server.post('/forms', async () => ({
			accepted: true,
		}));

		const response = await server.inject({
			method: 'POST',
			url: '/sessions',
			headers: {
				authorization: 'Bearer private',
				'content-type': 'application/json',
				'x-api-key': 'private-key',
			},
			payload: {
				email: 'person@example.com',
				password: 'private-password',
			},
		});
		await server.inject({
			method: 'POST',
			url: '/forms',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
			},
			payload: 'email=person%40example.com&password=private-password',
		});

		await server.close();
		await driver.close();

		const exchange = exchangeFromRecords(records);

		expect(response.statusCode).toBe(201);
		expect(exchange).toMatchObject({
			request: {
				method: 'POST',
				url: '/sessions',
				headers: {
					authorization: '[Redacted]',
					'content-type': 'application/json',
					'x-api-key': '[Redacted]',
				},
				body: {
					kind: 'json',
					truncated: false,
					value: {
						email: 'person@example.com',
						password: '[Redacted]',
					},
				},
			},
			response: {
				statusCode: 201,
				headers: {
					'set-cookie': '[Redacted]',
				},
				body: {
					kind: 'json',
					truncated: false,
					value: {
						created: true,
						credentials: {
							email: 'person@example.com',
							password: '[Redacted]',
						},
						token: '[Redacted]',
					},
				},
			},
		});

		const formExchange = records
			.filter(record => record.msg === 'request exchange')
			.map(record => record.httpExchange as HttpExchangeLog)
			.find(candidate => candidate.request.url === '/forms');

		expect(formExchange?.request.body.value).toEqual({
			email: 'person@example.com',
			password: '[Redacted]',
		});
	});

	it('bounds large text and omits binary response bodies', async () => {
		const records: Array<Record<string, unknown>> = [];
		const driver = new PinoLoggerDriver({
			devtools: false,
			environment: 'test',
			level: 'info',
			source: 'notes-test',
		}, captureDestination(records));
		const server = Fastify({
			loggerInstance: driver.logger as FastifyBaseLogger,
		});

		registerHttpExchangeMonitor(server, {
			environment: 'development',
			maxBodyBytes: 32,
		});
		server.get('/large', async (_request, reply) => {
			reply.type('text/plain');
			return 'x'.repeat(200);
		});
		server.get('/image', async (_request, reply) => {
			reply.type('image/png');
			return Buffer.from([137, 80, 78, 71]);
		});

		await server.inject('/large');
		await server.inject('/image');
		await server.close();
		await driver.close();

		const exchanges = records
			.filter(record => record.msg === 'request exchange')
			.map(record => record.httpExchange as HttpExchangeLog);

		expect(exchanges[0]?.response.body).toMatchObject({
			kind: 'text',
			sizeBytes: 200,
			truncated: true,
			value: `${'x'.repeat(29)}…`,
		});
		expect(exchanges[1]?.response.body).toMatchObject({
			kind: 'binary',
			sizeBytes: 4,
			note: 'Binary body omitted.',
		});
		expect(exchanges[1]?.response.body).not.toHaveProperty('value');
	});

	it('does not register exchange capture in production', async () => {
		const records: Array<Record<string, unknown>> = [];
		const driver = new PinoLoggerDriver({
			devtools: false,
			environment: 'production',
			level: 'info',
			source: 'notes-test',
		}, captureDestination(records));
		const server = Fastify({
			loggerInstance: driver.logger as FastifyBaseLogger,
		});

		registerHttpExchangeMonitor(server, {
			environment: 'production',
		});
		server.post('/sessions', async () => ({
			token: 'must-not-be-captured',
		}));

		await server.inject({
			method: 'POST',
			url: '/sessions',
			payload: {
				password: 'must-not-be-captured',
			},
		});
		await server.close();
		await driver.close();

		expect(records.some(record => record.msg === 'request exchange')).toBe(false);
		expect(JSON.stringify(records)).not.toContain('must-not-be-captured');
	});
});

/**
 * Returns the development HTTP exchange from captured Pino records.
 *
 * @param records - Parsed Pino records emitted by the Fastify test server.
 * @returns Structured request and response payload.
 */
function exchangeFromRecords(
	records: Array<Record<string, unknown>>,
): HttpExchangeLog {
	const record = records.find(candidate => candidate.msg === 'request exchange');

	expect(record).toBeDefined();

	return record?.httpExchange as HttpExchangeLog;
}

/**
 * Creates a writable Pino destination that retains parsed JSON records.
 *
 * @param records - Mutable record list populated by logger writes.
 * @returns Destination stream accepted by the Pino driver.
 */
function captureDestination(
	records: Array<Record<string, unknown>>,
): Writable {
	return new Writable({
		write(chunk, _encoding, callback) {
			records.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
			callback();
		},
	});
}

it('keeps streams untouched and honours route exclusions and capture opt-out', async () => {
	const { Readable } = await import('node:stream');
	const records: Array<Record<string, unknown>> = [];
	const driver = new PinoLoggerDriver({ environment: 'test', level: 'info' }, captureDestination(records));
	const server = Fastify({ loggerInstance: driver.logger as FastifyBaseLogger });
	registerHttpExchangeMonitor(server, { environment: 'development', exclude: request => request.url === '/private' });
	server.get('/private', async () => ({ personal: 'excluded' }));
	server.get('/stream', async (_request, reply) => reply.type('text/plain').send(Readable.from(['first', 'second'])));
	try {
		await server.inject('/private');
		expect((await server.inject('/stream')).body).toBe('firstsecond');
		const exchanges = records.filter(record => record.httpExchange).map(record => record.httpExchange as HttpExchangeLog);
		expect(exchanges).toHaveLength(1);
		expect(exchanges[0]?.response.body.kind).toBe('stream');
	} finally { await server.close(); await driver.close(); }
});

it('reports one cancellation for a real client disconnect after its request is received', async () => {
	const { request: httpRequest } = await import('node:http');
	const records: Array<Record<string, unknown>> = [];
	const driver = new PinoLoggerDriver({ environment: 'test', level: 'info' }, captureDestination(records));
	const server = Fastify({ loggerInstance: driver.logger as FastifyBaseLogger });
	registerHttpExchangeMonitor(server, { environment: 'development' });
	let received!: () => void;
	const started = new Promise<void>(resolve => { received = resolve; });
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	server.get('/slow', async () => { received(); await gate; return { done: true }; });
	try {
		await server.listen({ host: '127.0.0.1', port: 0 });
		const address = server.server.address() as { port: number };
		const client = httpRequest(`http://127.0.0.1:${address.port}/slow`);
		client.on('error', () => {});
		client.end();
		await started;
		client.destroy();
		await vi.waitFor(() => expect(records.filter(record => record.msg === 'request aborted')).toHaveLength(1));
	} finally { release(); await server.close(); await driver.close(); }
});
