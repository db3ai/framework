import 'dotenv/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Ai, AiRequest } from '@db3.ai/app/ai';
import { PasswordLoginAttempt, UserIdentity } from '@db3.ai/app/auth';
import { createApplication } from '../server/app';
import { createServer } from '../server/http/createServer';
import type { StarterConfig } from '../server/config';

// Explicit test-only connection. Never inherit the application DATABASE_URL.
delete process.env.DATABASE_URL;
process.env.DB_CONNECTION = 'mariadb';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
process.env.DB_DATABASE = 'db3_app_test';
process.env.DB_TEST_DATABASE_PREFIX = 'db3_app_test';
const config: StarterConfig = { name: 'Test app', origin: 'http://localhost:5173', port: 3001, host: '127.0.0.1', production: false, auth: { googleClientId: '' }, ai: { apiKey: '', model: 'test-model' } };
let database: GeneratedTestDatabase;
let application: ReturnType<typeof createApplication>;
let server: Awaited<ReturnType<typeof createServer>>;

/** Registers a real user and returns only the browser cookie transport. */
async function register(email = 'ada@example.test') {
	const response = await server.inject({ method: 'POST', url: '/api/register', headers: { origin: config.origin }, payload: { name: 'Ada', email, password: 'example-password-123' } });
	expect(response.statusCode).toBe(201);
	expect(response.headers['set-cookie']).toContain('HttpOnly');
	expect(response.body).not.toContain('token');
	return String(response.headers['set-cookie']).split(';')[0];
}

/** Saves a real owner-scoped note through the public HTTP API. */
async function save(cookie: string) {
	const response = await server.inject({ method: 'POST', url: '/api/notes', headers: { origin: config.origin, cookie }, payload: { title: 'Launch plan', body: 'Write the guide. Test the starter. Publish the packages.' } });
	expect(response.statusCode).toBe(201);
	return response.json().note.id as string;
}

beforeEach(async () => {
	database = await createGeneratedTestDatabase('starter');
	application = createApplication(config, { db: database.db });
	await application.db.migrations.migrate();
	server = await createServer(application, config);
});
afterEach(async () => {
	try { if (server) await server.close(); } finally { try { if (application) await application.close(); } finally { if (database) await database.destroy(); } }
});

describe('starter app', () => {
	it('maps known and unknown password suspension to the same response and permits verified recovery', async () => {
		await register();
		for (const email of ['ada@example.test', 'unknown@example.test']) {
			await PasswordLoginAttempt.create({ identityHash: PasswordLoginAttempt.identityKey(email), failedAttempts: 20, suspendedAt: new Date() }).save();
		}
		/** Exercises suspension through the application's real password route. */
		const login = (email: string) => server.inject({ method: 'POST', url: '/api/login', headers: { origin: config.origin }, payload: { email, password: 'example-password-123' } });
		const known = await login('ada@example.test');
		const unknown = await login('unknown@example.test');
		expect(known.statusCode).toBe(429);
		expect(unknown.statusCode).toBe(429);
		expect(known.json()).toEqual(unknown.json());
		expect(known.json().error).toBe('too_many_attempts');
		expect(known.headers['set-cookie']).toBeUndefined();
		const user = await UserIdentity.where('email', 'ada@example.test').first() as UserIdentity;
		const reset = await application.auth.createPasswordResetToken(user);
		await application.auth.resetPassword({ email: user.email!, token: reset.token, password: 'example-password-123' });
		expect((await login('ada@example.test')).statusCode).toBe(200);
	});

	/** Verifies migration execution and the committed snapshot agree after bootstrap. */
	it('applies server-owned migrations and matches the committed schema snapshot', async () => {
		const manager = application.db.migrations;
		const check = await manager.check();
		expect(check.matches).toBe(true);
		expect(check.migrations.completed.length).toBeGreaterThan(0);
		expect(check.migrations.pending).toEqual([]);
		expect(check.migrations.missingFiles).toEqual([]);
		expect((await manager.migrate()).applied).toEqual([]);
	});
	it('reads and edits only an owned note, preserves omitted fields and rejects invalid changes', async () => {
		const owner = await register();
		const stranger = await register('grace@example.test');
		const id = await save(owner);
		const headers = { cookie: owner, origin: config.origin };
		const original = (await server.inject({ url: `/api/notes/${id}`, headers })).json().note;
		for (const method of ['GET', 'PATCH'] as const) {
			const response = await server.inject({ method, url: `/api/notes/${id}`, headers: { cookie: stranger, origin: config.origin }, ...(method === 'PATCH' ? { payload: { title: 'Forbidden' } } : {}) });
			expect(response.statusCode).toBe(404);
		}
		for (const payload of [{}, { title: '   ' }, { owner: 'attacker' }, { title: 'x'.repeat(121) }]) {
			expect((await server.inject({ method: 'PATCH', url: `/api/notes/${id}`, headers, payload })).statusCode).toBe(400);
		}
		expect((await server.inject({ url: `/api/notes/${id}`, headers })).json().note).toEqual(original);
		const edited = await server.inject({ method: 'PATCH', url: `/api/notes/${id}`, headers, payload: { title: ' Revised plan ' } });
		expect(edited.statusCode).toBe(200);
		expect(edited.json().note).toMatchObject({ id, title: 'Revised plan', body: original.body, owner: original.owner });
		expect((await server.inject({ method: 'DELETE', url: `/api/notes/${id}`, headers })).statusCode).toBe(200);
		expect((await server.inject({ url: `/api/notes/${id}`, headers })).statusCode).toBe(404);
	});
	it('rejects a wrong password then recovers with valid credentials', async () => {
		await register();
		const invalid = await server.inject({ method: 'POST', url: '/api/login', headers: { origin: config.origin }, payload: { email: 'ada@example.test', password: 'incorrect-password' } });
		expect(invalid.statusCode).toBe(401);
		expect(invalid.headers['set-cookie']).toBeUndefined();
		const valid = await server.inject({ method: 'POST', url: '/api/login', headers: { origin: config.origin }, payload: { email: 'ada@example.test', password: 'example-password-123' } });
		expect(valid.statusCode).toBe(200);
		expect(valid.headers['set-cookie']).toContain('HttpOnly');
	});
	it('registers, saves, reloads, logs out and signs back in without an AI key', async () => {
		const cookie = await register();
		const id = await save(cookie);
		expect((await server.inject({ url: '/api/notes', headers: { cookie } })).json().notes[0].id).toBe(id);
		expect((await server.inject({ url: '/api/config' })).json().aiEnabled).toBe(false);
		const disabled = await server.inject({ method: 'POST', url: `/api/notes/${id}/summarise`, headers: { origin: config.origin, cookie }, payload: {} });
		expect(disabled.statusCode).toBe(503);
		expect(disabled.json().message).toContain('OPENAI_API_KEY');
		expect((await server.inject({ method: 'POST', url: '/api/logout', headers: { origin: config.origin, cookie }, payload: {} })).statusCode).toBe(200);
		expect((await server.inject({ url: '/api/notes', headers: { cookie } })).statusCode).toBe(401);
		const login = await server.inject({ method: 'POST', url: '/api/login', headers: { origin: config.origin }, payload: { email: 'ada@example.test', password: 'example-password-123' } });
		expect(login.statusCode).toBe(200);
	});
	it('rejects unauthenticated requests, invalid input and foreign origins', async () => {
		expect((await server.inject('/api/notes')).statusCode).toBe(401);
		expect((await server.inject({ method: 'POST', url: '/api/register', headers: { origin: 'https://evil.example' }, payload: {} })).statusCode).toBe(403);
		expect((await server.inject({ method: 'POST', url: '/api/register', headers: { origin: config.origin }, payload: { name: 'Ada', email: 'ada@example.test', password: 'short' } })).statusCode).toBe(400);
		const cookie = await register();
		expect((await server.inject({ method: 'POST', url: '/api/notes', headers: { origin: config.origin, cookie }, payload: { title: 'X', body: 'Y', owner: 'attacker' } })).statusCode).toBe(400);
	});
	it('summarises only the owner’s saved note and never returns the API key', async () => {
		await server.close();
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ object: 'response', id: 'resp_test', model: 'test-model', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A simulated summary.' }] }], usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } }));
		application.set('ai', new Ai({ apiKey: 'dummy-key-never-live', model: 'test-model', fetch, rateLimiter: false }));
		server = await createServer(application, { ...config, ai: { ...config.ai, apiKey: 'dummy-key-never-live' } });
		const owner = await register();
		const stranger = await register('grace@example.test');
		const id = await save(owner);
		expect((await server.inject({ url: '/api/notes', headers: { cookie: stranger } })).json().notes).toEqual([]);
		for (const method of ['POST', 'DELETE'] as const) {
			const denied = await server.inject({ method, url: `/api/notes/${id}${method === 'POST' ? '/summarise' : ''}`, headers: { cookie: stranger, origin: config.origin } });
			expect(denied.statusCode).toBe(404);
		}
		expect(fetch).not.toHaveBeenCalled();
		const result = await server.inject({ method: 'POST', url: `/api/notes/${id}/summarise`, headers: { cookie: owner, origin: config.origin }, payload: {} });
		expect(result.statusCode).toBe(200);
		expect(result.json().text).toBe('A simulated summary.');
		expect((await AiRequest.query().first())?.status).toBe('completed');
		expect(result.body).not.toContain('dummy-key');
		expect((await server.inject('/api/config')).body).not.toContain('dummy-key');
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('returns a safe AI error and permits a later retry after provider failure', async () => {
		await server.close();
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ error: { message: 'secret provider payload' } }, { status: 429 }));
		application.set('ai', new Ai({ apiKey: 'dummy-key-never-live', model: 'test-model', fetch, rateLimiter: false }));
		server = await createServer(application, { ...config, ai: { ...config.ai, apiKey: 'dummy-key-never-live' } });
		const cookie = await register();
		const id = await save(cookie);
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await server.inject({ method: 'POST', url: `/api/notes/${id}/summarise`, headers: { cookie, origin: config.origin }, payload: {} });
			expect(result.statusCode).toBe(429);
			expect(result.body).not.toContain('secret provider payload');
		}
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

/** Exercises inbox HTTP authorization and independent state through the real migrated database. */
it('persists demo messages, isolates users and keeps banner dismissal separate from reading', async () => {
	const owner = await register();
	const stranger = await register('other@example.test');
	const headers = { cookie: owner, origin: config.origin };
	expect((await server.inject('/api/inbox')).statusCode).toBe(401);
	const sent = await server.inject({ method: 'POST', url: '/api/inbox/demo', headers, payload: { presentation: 'banner' } });
	expect(sent.statusCode).toBe(201);
	const id = sent.json().id;
	const read = async (cookie = owner, suffix = '') => (await server.inject({ url: `/api/inbox${suffix}`, headers: { cookie } })).json();
	const change = async (transition: string, cookie = owner) => server.inject({ method: 'POST', url: `/api/inbox/${id}`, headers: { cookie, origin: config.origin }, payload: { transition } });
	expect((await read()).unreadCount).toBe(1);
	expect((await read(stranger)).items).toEqual([]);
	expect((await change('read', stranger)).statusCode).toBe(404);
	expect((await change('dismiss')).statusCode).toBe(200);
	expect((await read(owner, '?view=banners')).items).toEqual([]);
	expect((await read()).items[0]).toMatchObject({ id, readAt: null });
	expect((await read()).unreadCount).toBe(1);
	await change('read');
	expect((await read()).unreadCount).toBe(0);
	await change('unread');
	expect((await read()).unreadCount).toBe(1);
	await change('archive');
	expect((await read()).items).toEqual([]);
	expect((await change('delete')).statusCode).toBe(400);
	expect((await server.inject({ method: 'POST', url: '/api/inbox/demo', headers, payload: { presentation: 'toast', userId: 'someone-else' } })).statusCode).toBe(400);
	expect((await server.inject({ method: 'POST', url: '/api/inbox/demo', headers: { cookie: owner, origin: 'https://foreign.example' }, payload: { presentation: 'toast' } })).statusCode).toBe(403);
});
