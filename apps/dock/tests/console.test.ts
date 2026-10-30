import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DockState, ProcessSnapshot } from '../shared/contracts.js';
import { ConsoleKeys } from '../server/console/ConsoleKeys.js';
import { candidatePorts, registerConsoleRoutes } from '../server/console/consoleRoutes.js';
import type { Dock } from '../server/Dock.js';

let folder: string;
let keys: ConsoleKeys;
let app: FastifyInstance;
let appPort: number;
let server: FastifyInstance;
let state: DockState;
const seen: { method: string; url: string; auth?: string; body?: unknown }[] = [];

/** A running process of the fixture project, listening on the given ports. */
function running(id: string, port: number | null, ports: number[] = []): ProcessSnapshot {
	return { id, projectId: 'shop', status: 'running', pid: 1, startedAt: 0, exitCode: null, port, ports, cpu: null, memory: null } as ProcessSnapshot;
}

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), 'dock-console-'));
	keys = new ConsoleKeys(join(folder, 'console.key'));
	await keys.open();
	seen.length = 0;
	// Stands in for a db3 app answering /_db3/console with the project's token.
	app = Fastify();
	app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
	app.all('/_db3/console/*', async (request, reply) => {
		seen.push({ method: request.method, url: request.url, auth: request.headers.authorization, body: request.body });
		if (request.headers.authorization !== `Bearer ${keys.token('/work/shop')}`) return reply.code(401).send({ message: 'The console token is missing or wrong.' });
		if (request.url.startsWith('/_db3/console/storage/file')) return reply.header('content-disposition', 'attachment; filename="a.txt"').type('text/plain').send('hello');
		if (request.url === '/_db3/console/') return { app: 'shop', database: { available: true } };
		return { ok: true, url: request.url };
	});
	await app.listen({ port: 0, host: '127.0.0.1' });
	appPort = (app.server.address() as { port: number }).port;
	state = { projects: [{ id: 'shop', name: 'shop', path: '/work/shop', processes: [{ id: 'shop-web', name: 'web', script: 'dev', args: [], kind: 'web', saved: true }] }], processes: [], proxies: [], branches: {} } as DockState;
	server = Fastify();
	await registerConsoleRoutes(server, { state: () => state } as unknown as Dock, keys);
});

afterEach(async () => {
	await server.close();
	await app.close();
	await rm(folder, { recursive: true, force: true });
});

describe('console proxy', () => {
	it('keeps one secret, readable only by this user, and gives each project folder its own stable token', async () => {
		expect((await stat(join(folder, 'console.key'))).mode & 0o777).toBe(0o600);
		const again = new ConsoleKeys(join(folder, 'console.key'));
		await again.open();
		expect(again.token('/work/shop')).toBe(keys.token('/work/shop'));
		expect(keys.token('/work/other')).not.toBe(keys.token('/work/shop'));
		expect((await readFile(join(folder, 'console.key'), 'utf8')).trim()).toHaveLength(64);
	});

	it('asks for the web process when nothing runs', async () => {
		const response = await server.inject({ url: '/api/projects/shop/console/database/tables' });
		expect(response.statusCode).toBe(409);
		expect(response.json().message).toBe("Start shop's web or api process to open its console.");
		expect((await server.inject({ url: '/api/projects/nope/console/' })).statusCode).toBe(404);
	});

	it('finds the port that answers, adds the token and passes requests and answers through', async () => {
		state.processes = [running('shop-web', 1, [1, appPort])];
		const get = await server.inject({ url: '/api/projects/shop/console/database/tables/notes/rows?page=2&limit=10' });
		expect(get.statusCode).toBe(200);
		expect(get.json().url).toBe('/_db3/console/database/tables/notes/rows?page=2&limit=10');
		const post = await server.inject({ method: 'POST', url: '/api/projects/shop/console/database/tables/notes/rows', payload: { values: { title: 'Hi' } } });
		expect(post.statusCode).toBe(200);
		expect(seen.at(-1)).toMatchObject({ method: 'POST', auth: `Bearer ${keys.token('/work/shop')}`, body: { values: { title: 'Hi' } } });
		const upload = await server.inject({ method: 'PUT', url: '/api/projects/shop/console/storage/file?disk=local&path=a.txt', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('bytes') });
		expect(upload.statusCode).toBe(200);
		expect(Buffer.from(seen.at(-1)!.body as Buffer).toString()).toBe('bytes');
		const download = await server.inject({ url: '/api/projects/shop/console/storage/file?disk=local&path=a.txt' });
		expect(download.body).toBe('hello');
		expect(download.headers['content-disposition']).toBe('attachment; filename="a.txt"');
	});

	it('says to restart an app that was started outside Dock', async () => {
		state.projects[0]!.path = '/work/elsewhere';
		state.processes = [running('shop-web', appPort)];
		const response = await server.inject({ url: '/api/projects/shop/console/' });
		expect(response.statusCode).toBe(409);
		expect(response.json().message).toContain('Restart its web process from Dock');
	});

	it('skips a dev server that answers every path with its page', async () => {
		const vite = Fastify();
		vite.get('/*', async (_request, reply) => reply.type('text/html').send('<!doctype html>'));
		await vite.listen({ port: 0, host: '127.0.0.1' });
		state.processes = [running('shop-web', (vite.server.address() as { port: number }).port, [appPort])];
		const response = await server.inject({ url: '/api/projects/shop/console/' });
		expect(response.json()).toMatchObject({ app: 'shop' });
		await vite.close();
	});

	it('tries web and api ports before other processes', () => {
		expect(candidatePorts([running('queue', 7000), running('shop-web', 5173, [3001, 5173])], ['shop-web'])).toEqual([5173, 3001, 7000]);
	});
});
