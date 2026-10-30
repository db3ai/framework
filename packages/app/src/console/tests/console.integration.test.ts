import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleDatabase, ConsoleError, ConsoleStorage, fileFlows, knexExecutor, type ConsoleExecutor } from '@db3.ai/app/console';
import { registerConsoleRoutes, type ConsoleServices } from '@db3.ai/app/console/fastify';
import { openProjectConsole } from '@db3.ai/app/console/project';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Storage } from '@db3.ai/app/storage';

/** Stands in for the host's own sign-in, such as Dock's or db3 Cloud's. */
const auth = { authorization: 'host-user' };
/** Every statement the console ran, to show it goes through the host's executor. */
const statements: string[] = [];

let database: GeneratedTestDatabase;
let folder: string;
let server: FastifyInstance;
let services: ConsoleServices;

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
	await mkdir(join(folder, 'db3/tables'), { recursive: true });
	await writeFile(join(folder, 'db3/tables/console_owners.json'), JSON.stringify({ name: 'console_owners', fields: [] }));
	const runner = knexExecutor(knex);
	const executor: ConsoleExecutor = { client: runner.client, run: (sql, bindings) => { statements.push(sql); return runner.run(sql, bindings); } };
	services = {
		name: 'console-test',
		environment: 'local',
		database: new ConsoleDatabase(executor, { list: async () => [{ name: 'console_owners', path: 'db3/tables/console_owners.json' }] }),
		storage: new ConsoleStorage(new Storage({ disks: { local: { driver: 'local', root: join(folder, 'files') } } }), { local: { driver: 'local' } }),
		flows: { unavailable: 'This app does not load flows yet.' },
	};
	server = Fastify();
	await registerConsoleRoutes(server, '/_db3/console', async request => {
		if (request.headers.authorization !== 'host-user') throw new ConsoleError('Sign in first.', 401);
		return services;
	});
	await server.ready();
}, 60_000);

afterAll(async () => {
	await server?.close();
	await database?.destroy();
	await rm(folder, { recursive: true, force: true });
});

describe('console routes', () => {
	it('answers only when the host lets the request in, and says what the app offers', async () => {
		expect((await server.inject({ url: '/_db3/console/' })).statusCode).toBe(401);
		const info = await server.inject({ url: '/_db3/console/', headers: auth });
		expect(info.json()).toMatchObject({ app: 'console-test', environment: 'local', database: { available: true }, storage: { available: true }, flows: { available: false } });
	});

	it('lists tables with keys, links, secrets and read-only system tables', async () => {
		const { tables } = (await server.inject({ url: '/_db3/console/database/tables', headers: auth })).json();
		const notes = tables.find((table: { name: string }) => table.name === 'console_notes');
		expect(notes.primaryKey).toEqual(['id']);
		expect(notes.columns.find((column: { name: string }) => column.name === 'owner_id').references).toEqual({ table: 'console_owners', column: 'id' });
		expect(tables.find((table: { name: string }) => table.name === 'console_owners').columns.find((column: { name: string }) => column.name === 'password_hash').secret).toBe(true);
		expect(tables.find((table: { name: string }) => table.name === 'knex_migrations').readOnly).toBe('Kept by the migration tool');
		expect(tables.find((table: { name: string }) => table.name === 'console_owners').source).toEqual({ kind: 'file', path: 'db3/tables/console_owners.json' });
		expect(statements.some(sql => sql.includes('information_schema.COLUMNS'))).toBe(true);
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

	it('refuses data changes where the host made rows read-only, and says so to the screens', async () => {
		services.readOnly = { rows: 'Production data is read-only here.', schema: 'Design tables in a development environment.' };
		try {
			expect((await server.inject({ url: '/_db3/console/', headers: auth })).json().readOnly).toEqual({ rows: 'Production data is read-only here.', schema: 'Design tables in a development environment.' });
			const page = (await server.inject({ url: '/_db3/console/database/tables/console_notes/rows', headers: auth })).json();
			expect(page.table.readOnly).toBe('Production data is read-only here.');
			const add = await server.inject({ method: 'POST', url: '/_db3/console/database/tables/console_notes/rows', headers: auth, payload: { values: { title: 'Nope' } } });
			expect(add.statusCode).toBe(403);
			expect((await server.inject({ method: 'POST', url: '/_db3/console/storage/changes', headers: auth, payload: { disk: 'local', action: 'mkdir', path: '/x' } })).statusCode).toBe(403);
		} finally {
			delete services.readOnly;
		}
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

describe('a project opened from its folder', () => {
	it('reads definitions from db3/ and says why the database is missing', async () => {
		const project = join(folder, 'project');
		await mkdir(join(project, 'db3/flows'), { recursive: true });
		await writeFile(join(project, '.env'), 'APP_NAME=Shop\n');
		const opened = await openProjectConsole(project);
		try {
			expect(opened.services.name).toBe('project');
			expect(opened.services.database).toEqual({ unavailable: "This app's .env doesn't name a database (DB_DATABASE or DATABASE_URL)." });
			const flows = opened.services.flows as ReturnType<typeof fileFlows>;
			expect(await flows.listDefinitions()).toEqual([]);
			expect(flows.blockMetadata().length).toBeGreaterThan(0);
			expect((opened.services.storage as ConsoleStorage).disks()).toEqual([{ name: 'local', driver: 'local', default: true }]);
		} finally {
			await opened.close();
		}
	});

	it('connects to the database its .env names', async () => {
		const project = join(folder, 'connected');
		await mkdir(project, { recursive: true });
		const config = database.db.client.config.connection as { host?: string; port?: number; user?: string; password?: string; database?: string };
		await writeFile(join(project, '.env'), `DB_HOST=${config.host ?? '127.0.0.1'}\nDB_PORT=${config.port ?? 3306}\nDB_USER=${config.user ?? 'root'}\nDB_PASSWORD=${config.password ?? ''}\nDB_DATABASE=${config.database}\n`);
		const opened = await openProjectConsole(project, { name: 'Connected' });
		try {
			const rows = await (opened.services.database as ConsoleDatabase).rows('console_owners');
			expect(rows.rows.map(row => row.name)).toEqual(['Ada Lovelace', 'Max Planck']);
		} finally {
			await opened.close();
		}
	});
});
