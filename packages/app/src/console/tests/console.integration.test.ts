import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerConsoleRoutes, type ConsoleRouteOptions } from '@db3.ai/app/console/fastify';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Storage } from '@db3.ai/app/storage';

const TOKEN = 'console-test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

let database: GeneratedTestDatabase;
let folder: string;
let server: FastifyInstance;

beforeAll(async () => {
	database = await createGeneratedTestDatabase('console');
	folder = await mkdtemp(join(tmpdir(), 'db3-console-'));
	const knex = database.db;
	await knex.schema.createTable('console_owners', table => { table.string('id', 26).primary(); table.string('name'); table.string('password_hash'); });
	await knex.schema.createTable('console_notes', table => {
		table.increments('id');
		table.string('title').notNullable();
		table.dateTime('due_at').nullable();
		table.string('owner_id', 26).nullable().references('id').inTable('console_owners');
	});
	await knex.schema.createTable('knex_migrations', table => { table.increments('id'); table.string('name'); });
	await knex('console_owners').insert([{ id: '01JBXOWNER0000000000000001', name: 'Ada Lovelace', password_hash: 'secret-hash' }, { id: '01JBXOWNER0000000000000002', name: 'Max Planck', password_hash: 'x' }]);
	await knex('console_notes').insert({ title: 'First', due_at: '2026-10-29 12:30:00', owner_id: '01JBXOWNER0000000000000001' });
	server = Fastify();
	const app = { db: { knex, tableDirectory: join(folder, 'db3/tables') }, storage: new Storage({ disks: { local: { driver: 'local', root: join(folder, 'files') } } }), directory: folder } as unknown as ConsoleRouteOptions['app'];
	await registerConsoleRoutes(server, { app, token: TOKEN, name: 'console-test', disks: { local: { driver: 'local' } } });
	await server.ready();
}, 60_000);

afterAll(async () => {
	await server?.close();
	await database?.destroy();
	await rm(folder, { recursive: true, force: true });
});

describe('console routes', () => {
	it('registers nothing without a token, and refuses requests without the right one', async () => {
		const bare = Fastify();
		expect(await registerConsoleRoutes(bare, { app: {} as ConsoleRouteOptions['app'], token: '' })).toBe(false);
		await bare.ready();
		expect((await bare.inject({ url: '/_db3/console/' })).statusCode).toBe(404);
		await bare.close();
		expect((await server.inject({ url: '/_db3/console/' })).statusCode).toBe(401);
		expect((await server.inject({ url: '/_db3/console/', headers: { authorization: 'Bearer wrong-token-value!' } })).statusCode).toBe(401);
		const info = await server.inject({ url: '/_db3/console/', headers: auth });
		expect(info.json()).toMatchObject({ app: 'console-test', database: { available: true }, storage: { available: true }, flows: { available: false } });
	});

	it('lists tables with keys, links, secrets and read-only system tables', async () => {
		const { tables } = (await server.inject({ url: '/_db3/console/database/tables', headers: auth })).json();
		const notes = tables.find((table: { name: string }) => table.name === 'console_notes');
		expect(notes.primaryKey).toEqual(['id']);
		expect(notes.columns.find((column: { name: string }) => column.name === 'owner_id').references).toEqual({ table: 'console_owners', column: 'id' });
		expect(tables.find((table: { name: string }) => table.name === 'console_owners').columns.find((column: { name: string }) => column.name === 'password_hash').secret).toBe(true);
		expect(tables.find((table: { name: string }) => table.name === 'knex_migrations').readOnly).toBe('Kept by the migration tool');
	});

	it('reads a page of rows as text, hides secrets and labels linked rows', async () => {
		const page = (await server.inject({ url: '/_db3/console/database/tables/console_notes/rows?page=1&limit=10', headers: auth })).json();
		expect(page.total).toBe(1);
		expect(page.rows[0]).toMatchObject({ id: '1', title: 'First', due_at: '2026-10-29 12:30:00', owner_id: '01JBXOWNER0000000000000001' });
		expect(page.linkLabels.owner_id).toEqual({ '01JBXOWNER0000000000000001': 'Ada Lovelace' });
		const owners = (await server.inject({ url: '/_db3/console/database/tables/console_owners/rows', headers: auth })).json();
		expect(owners.rows[0].password_hash).toBeNull();
	});

	it('adds, changes and deletes one row, and refuses secret columns and system tables', async () => {
		const add = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_notes/rows', headers: auth, payload: { values: { title: 'Second', owner_id: '01JBXOWNER0000000000000002' } } });
		expect(add.statusCode).toBe(201);
		const change = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_notes/rows/update', headers: auth, payload: { key: { id: 2 }, values: { title: 'Second, edited' } } });
		expect(change.statusCode).toBe(200);
		expect((await database.db('console_notes').where({ id: 2 }).first()).title).toBe('Second, edited');
		const secret = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_owners/rows/update', headers: auth, payload: { key: { id: '01JBXOWNER0000000000000001' }, values: { password_hash: 'new' } } });
		expect(secret.statusCode).toBe(400);
		const system = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/knex_migrations/rows', headers: auth, payload: { values: { name: 'x' } } });
		expect(system.statusCode).toBe(409);
		const missing = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_notes/rows', headers: auth, payload: { values: { title: null } } });
		expect(missing.statusCode).toBe(422);
		const remove = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_notes/rows/delete', headers: auth, payload: { key: { id: 2 } } });
		expect(remove.statusCode).toBe(200);
		expect(await database.db('console_notes').count({ total: '*' })).toEqual([{ total: 1 }]);
		expect((await server.inject({ url: '/_db3/console/database/tables/nope/rows', headers: auth })).statusCode).toBe(404);
	});

	it('searches the rows a link column can point at', async () => {
		const found = (await server.inject({ url: '/_db3/console/database/tables/console_notes/options?column=owner_id&q=planck', headers: auth })).json();
		expect(found).toEqual({ table: 'console_owners', options: [{ value: '01JBXOWNER0000000000000002', label: 'Max Planck' }], more: false });
		expect((await server.inject({ url: '/_db3/console/database/tables/console_notes/options?column=title', headers: auth })).statusCode).toBe(400);
	});

	it('browses and changes files on a disk', async () => {
		expect((await server.inject({ url: '/_db3/console/storage/disks', headers: auth })).json()).toEqual({ disks: [{ name: 'local', driver: 'local', default: true }] });
		const send = (payload: object) => server.inject({ method: 'POST', url: '/_db3/console/storage/changes', headers: auth, payload });
		expect((await send({ disk: 'local', action: 'mkdir', path: '/reports' })).statusCode).toBe(200);
		const upload = await server.inject({ method: 'PUT', url: '/_db3/console/storage/file?disk=local&path=%2Freports%2Fq3.txt', headers: { ...auth, 'content-type': 'application/octet-stream' }, payload: Buffer.from('third quarter') });
		expect(upload.statusCode).toBe(201);
		const root = (await server.inject({ url: '/_db3/console/storage?disk=local&path=%2F', headers: auth })).json();
		expect(root.entries.map((entry: { name: string; type: string }) => [entry.name, entry.type])).toEqual([['reports', 'dir']]);
		const inside = (await server.inject({ url: '/_db3/console/storage?disk=local&path=%2Freports', headers: auth })).json();
		expect(inside.entries).toMatchObject([{ name: 'q3.txt', type: 'file', size: 13 }]);
		const download = await server.inject({ url: '/_db3/console/storage/file?disk=local&path=reports%2Fq3.txt', headers: auth });
		expect(download.body).toBe('third quarter');
		expect(download.headers['content-disposition']).toContain('q3.txt');
		expect((await send({ disk: 'local', action: 'move', path: '/reports', to: '/archive' })).statusCode).toBe(200);
		const moved = (await server.inject({ url: '/_db3/console/storage?disk=local&path=%2F', headers: auth })).json();
		expect(moved.entries.map((entry: { name: string }) => entry.name)).toEqual(['archive']);
		expect((await send({ disk: 'local', action: 'delete', path: '/archive' })).statusCode).toBe(200);
		expect((await server.inject({ url: '/_db3/console/storage?disk=local&path=%2F', headers: auth })).json().entries).toEqual([]);
		expect((await server.inject({ url: '/_db3/console/storage?disk=local&path=..%2Fsecrets', headers: auth })).statusCode).toBe(400);
		expect((await server.inject({ url: '/_db3/console/storage?disk=other&path=%2F', headers: auth })).statusCode).toBe(404);
	});

	it('says when the app has no flows', async () => {
		const response = await server.inject({ url: '/_db3/console/flows', headers: auth });
		expect(response.statusCode).toBe(404);
		expect(response.json().message).toBe('This app does not load flows yet.');
	});
});
