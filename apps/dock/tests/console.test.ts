import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DockState } from '../shared/contracts.js';
import { registerConsoleRoutes } from '../server/console/consoleRoutes.js';
import type { Dock } from '../server/Dock.js';

let folder: string;
let server: FastifyInstance;
let state: DockState;

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), 'dock-console-'));
	await mkdir(join(folder, 'storage/app/reports'), { recursive: true });
	await writeFile(join(folder, 'storage/app/reports/q3.txt'), 'third quarter');
	await writeFile(join(folder, '.env'), 'APP_NAME=Shop\n');
	state = { projects: [{ id: 'shop', name: 'Shop', path: folder, processes: [] }], processes: [], proxies: [], branches: {} } as unknown as DockState;
	server = Fastify();
	await registerConsoleRoutes(server, { state: () => state } as unknown as Dock);
});

afterEach(async () => {
	await server.close();
	await rm(folder, { recursive: true, force: true });
});

describe('console', () => {
	it('opens a project from its folder, without the app running', async () => {
		const info = (await server.inject({ url: '/api/projects/shop/console/' })).json();
		expect(info).toMatchObject({ app: 'Shop', environment: 'local', storage: { available: true }, flows: { available: true } });
		expect(info.database).toEqual({ available: false, reason: "This app's .env doesn't name a database (DB_DATABASE or DATABASE_URL)." });
		expect((await server.inject({ url: '/api/projects/nope/console/' })).statusCode).toBe(404);
	});

	it('browses and changes the local storage disk', async () => {
		const listing = (await server.inject({ url: '/api/projects/shop/console/storage?disk=local&path=%2Freports' })).json();
		expect(listing.entries).toMatchObject([{ name: 'q3.txt', type: 'file', size: 13 }]);
		const upload = await server.inject({ method: 'PUT', url: '/api/projects/shop/console/storage/file?disk=local&path=%2Freports%2Fq4.txt', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('fourth') });
		expect(upload.statusCode).toBe(201);
		expect((await server.inject({ url: '/api/projects/shop/console/storage/file?disk=local&path=reports%2Fq4.txt' })).body).toBe('fourth');
	});

	it('lists and saves flow files in db3/flows', async () => {
		const empty = (await server.inject({ url: '/api/projects/shop/console/flows' })).json();
		expect(empty.flows).toEqual([]);
		expect(empty.blocks.length).toBeGreaterThan(0);
	});

	it('reopens the project when its .env changes', async () => {
		await server.inject({ url: '/api/projects/shop/console/' });
		await writeFile(join(folder, '.env'), 'DB_CONNECTION=postgres\nDB_DATABASE=shop\n');
		const info = (await server.inject({ url: '/api/projects/shop/console/' })).json();
		expect(info.database.reason).toBe('The console reads MariaDB and MySQL databases; this app uses Postgres.');
	});
});
