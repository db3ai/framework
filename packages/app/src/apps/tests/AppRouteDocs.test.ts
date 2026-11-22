import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { App } from '@db3.ai/app/server';
import { defineSubApp, AppRouteError, appOpenApi, appReference, appTools, type SubAppDefinition } from '@db3.ai/app/apps';
import { registerAppMcp, registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

/** A notes app with described routes: a read, a change and a delete, scoped to a team. */
function notes(): SubAppDefinition<{ notes: Map<string, string> }> {
	return defineSubApp({
		manifest: { id: 'notes', name: 'Notes', version: '1.0.0', icon: '✎' },
		create: () => ({ notes: new Map([['n1', 'Buy flour']]) }),
		routes: [
			{ method: 'GET', path: '/teams/:team/notes', risk: 'read', summary: 'Lists the team\'s notes.', input: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) }, handle: ({ service, params, query }) => ({ team: params.team, limit: query.limit, notes: [...service.notes].map(([id, text]) => ({ id, text })) }) },
			{ method: 'POST', path: '/teams/:team/notes', risk: 'change', summary: 'Adds a note.', status: 201, input: { body: z.object({ text: z.string().min(1).max(200) }) }, handle: ({ service, body, actor }) => { service.notes.set(`n${service.notes.size + 1}`, (body as { text: string }).text); return { by: actor }; } },
			{ method: 'DELETE', path: '/teams/:team/notes/:note', risk: 'destructive', summary: 'Deletes a note.', handle: ({ service, params }) => { if (!service.notes.delete(params.note!)) throw new AppRouteError(404, 'No such note.'); return {}; } },
			{ method: 'POST', path: '/teams/:team/tags', risk: 'change', summary: 'Sets the team\'s tags.', input: { body: z.array(z.string()).max(5) }, handle: ({ body }) => ({ tags: body }) },
			{ method: 'GET', path: '/', handle: () => ({ hello: true }) },
		],
	});
}

let database: GeneratedTestDatabase;
let application: App;
beforeEach(async () => {
	database = await createGeneratedTestDatabase('app_route_docs');
	application = new App({ db: database.db, apps: { notes: notes() } });
	await application.apps.install('notes');
	await application.apps.boot();
});
afterEach(async () => {
	try { await application.close(); } finally { await database.destroy(); }
});

describe('route input', () => {
	it('is checked before the handler runs, with the reason for a refusal', async () => {
		const server = Fastify();
		registerAppRoutes(server, application.apps, async () => ({ id: 'ana' }));
		try {
			expect((await server.inject('/api/apps/notes/teams/t1/notes?limit=3')).json()).toMatchObject({ team: 't1', limit: 3 });
			expect((await server.inject('/api/apps/notes/teams/t1/notes')).json()).toMatchObject({ limit: 10 });
			const tooMany = await server.inject('/api/apps/notes/teams/t1/notes?limit=500');
			expect(tooMany.statusCode).toBe(400);
			expect(tooMany.json().message).toMatch(/^query\.limit: /);
			const empty = await server.inject({ method: 'POST', url: '/api/apps/notes/teams/t1/notes', payload: { text: '' } });
			expect(empty.statusCode).toBe(400);
			expect(empty.json().message).toMatch(/^body\.text: /);
			expect((await server.inject({ method: 'POST', url: '/api/apps/notes/teams/t1/notes', payload: { text: 'Bake' } })).statusCode).toBe(201);
			expect((await server.inject({ method: 'POST', url: '/api/apps/notes/teams/t1/notes', headers: { 'content-type': 'application/json' }, payload: 'null' })).statusCode).toBe(400);
			expect((await server.inject({ method: 'POST', url: '/api/apps/notes/teams/t1/tags', payload: ['a', 'b'] })).json()).toEqual({ tags: ['a', 'b'] });
		} finally { await server.close(); }
	});
});

describe('generated docs', () => {
	it('list every route with its summary, risk, tool and input', () => {
		const tools = appTools(application.apps.routes(), { fixed: ['team'] });
		const spec = appOpenApi(application.apps.routes(), { info: { title: 'Notes API', version: '1' }, tools });
		expect(Object.keys(spec.paths)).toEqual(['/api/apps/notes/teams/{team}/notes', '/api/apps/notes/teams/{team}/notes/{note}', '/api/apps/notes/teams/{team}/tags', '/api/apps/notes']);
		const list = spec.paths['/api/apps/notes/teams/{team}/notes'].get;
		expect(list).toMatchObject({ summary: 'Lists the team\'s notes.', 'x-db3-risk': 'read', 'x-db3-tool': 'notes', tags: ['notes'] });
		expect(list.parameters).toEqual([
			{ name: 'team', in: 'path', required: true, schema: { type: 'string' } },
			{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
		]);
		const add = spec.paths['/api/apps/notes/teams/{team}/notes'].post;
		expect(add.requestBody.content['application/json'].schema).toMatchObject({ properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] });
		expect(add['x-db3-tool']).toBeUndefined();
		expect(spec.info.description).toContain('`destructive`');

		const reference = appReference(spec, { intro: 'Sign in first.', mount: '/api/apps/notes' });
		expect(reference).toContain('# Notes API\n\nSign in first.');
		expect(reference).toContain('| `GET /teams/{team}/notes` | `read` | `notes` | Lists the team\'s notes. |');
		expect(reference).toContain('| `POST /teams/{team}/notes` | `change` |  | Adds a note. Body: `text` (string). |');
		expect(reference).toContain('| `GET /` |  |  |  |');
	});

	it('offer only described routes of the allowed risks as tools, named from their paths', () => {
		const routes = application.apps.routes();
		expect(appTools(routes, { fixed: ['team'] }).map(tool => tool.name)).toEqual(['notes']);
		const tools = appTools(routes, { fixed: ['team'], risks: ['read', 'change', 'destructive'], include: entry => entry.route.method !== 'DELETE' });
		expect(tools.map(tool => tool.name)).toEqual(['notes', 'post_notes', 'post_tags']);
		expect(tools[1]!.inputSchema.properties).toMatchObject({ body: { properties: { text: { type: 'string' } } }, reason: { type: 'string' } });
		expect(appTools(routes, { risks: ['destructive'] })[0]).toMatchObject({ name: 'delete_teams_notes', params: ['team', 'note'], annotations: { destructiveHint: true, readOnlyHint: false } });
		const clash = [{ appId: 'a', route: { method: 'GET', path: '/x', risk: 'read', summary: 'X.', handle: () => null } }, { appId: 'b', route: { method: 'GET', path: '/x', risk: 'read', summary: 'X.', handle: () => null } }] as const;
		expect(() => appTools(clash)).toThrow('would both be the tool x');
	});
});

describe('the MCP server', () => {
	const origin = 'https://notes.example';
	let server: ReturnType<typeof Fastify>;
	let next = 1;
	const rpc = (method: string, params?: object, headers: Record<string, string> = { authorization: 'Bearer key' }) => server.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json', ...headers }, payload: { jsonrpc: '2.0', id: next++, method, ...(params ? { params } : {}) } });
	const call = async (name: string, args: object = {}) => (await rpc('tools/call', { name, arguments: args })).json().result;

	beforeEach(() => {
		server = Fastify();
		registerAppMcp(server, application.apps, {
			serverInfo: { name: 'notes', title: 'Notes', version: '1' }, instructions: 'Start with notes.', origin,
			tools: appTools(application.apps.routes(), { fixed: ['team'], risks: ['read', 'change', 'destructive'] }),
			async authorize(request) {
				if (request.headers.authorization !== 'Bearer key') throw new AppRouteError(401, 'Sign in with a key.');
				return { actor: { id: 'agent', via: 'mcp' }, params: { team: 't1' } };
			},
		});
	});
	afterEach(async () => { await server.close(); });

	it('introduces itself and lists the tools without their routes', async () => {
		expect((await rpc('initialize', { protocolVersion: '2025-03-26' })).json().result).toEqual({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'notes', title: 'Notes', version: '1' }, instructions: 'Start with notes.' });
		expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).json().result.protocolVersion).toBe('2025-06-18');
		expect((await server.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer key' }, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })).statusCode).toBe(202);
		const { tools } = (await rpc('tools/list')).json().result;
		expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['notes', 'post_notes', 'delete_notes', 'post_tags']);
		expect(tools[0]).toEqual({ name: 'notes', description: 'Lists the team\'s notes.', inputSchema: expect.any(Object), annotations: { title: 'notes', readOnlyHint: true, destructiveHint: false } });
		expect((await rpc('ping')).json().result).toEqual({});
		expect((await rpc('nothing')).json().error.code).toBe(-32601);
	});

	it('runs routes with the same checks, for the signed-in actor and scope, with the reason', async () => {
		expect(JSON.parse((await call('notes', { query: { limit: '2' } })).content[0].text)).toMatchObject({ team: 't1', limit: 2 });
		expect(JSON.parse((await call('post_notes', { body: { text: 'Bake' }, reason: 'Asked to.' })).content[0].text)).toEqual({ by: { id: 'agent', via: 'mcp', reason: 'Asked to.' } });
		expect(await call('post_notes', { body: { text: '' } })).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^body\.text: /) }] });
		expect(await call('delete_notes', { note: 'missing' })).toEqual({ isError: true, content: [{ type: 'text', text: 'No such note.' }] });
		expect(await call('delete_notes', {})).toMatchObject({ isError: true, content: [{ text: 'Give note as an id.' }] });
		expect(await call('delete_notes', { note: '../x/y' })).toMatchObject({ isError: true });
		expect(await call('nope')).toMatchObject({ isError: true });
		expect(JSON.parse((await call('post_tags', { body: ['a'] })).content[0].text)).toEqual({ tags: ['a'] });
	});

	it('refuses unknown callers, web pages and streams', async () => {
		expect((await rpc('tools/list', undefined, {})).statusCode).toBe(401);
		expect((await rpc('tools/list', undefined, { authorization: 'Bearer key', origin: 'https://evil.example' })).statusCode).toBe(403);
		expect((await rpc('tools/list', undefined, { authorization: 'Bearer key', origin })).statusCode).toBe(200);
		expect((await server.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer key' }, payload: [] })).statusCode).toBe(400);
		expect((await server.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
	});
});
