import { afterEach, beforeEach, expect, it } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { createApplication } from '../server/app';
import { createServer } from '../server/http/createServer';
import type { StarterConfig } from '../server/config';

delete process.env.DATABASE_URL;
process.env.DB_CONNECTION = 'mariadb';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
process.env.DB_DATABASE = 'db3_app_test';
process.env.DB_TEST_DATABASE_PREFIX = 'db3_app_test';
const config: StarterConfig = { name: 'Rooms test', origin: 'http://localhost:5173', port: 0, host: '127.0.0.1', production: false, auth: { googleClientId: '' }, ai: { apiKey: '', model: 'test' } };
let database: GeneratedTestDatabase;
let application: ReturnType<typeof createApplication>;
let server: Awaited<ReturnType<typeof createServer>>;
let address: string;
const clients: WebSocket[] = [];

/** Opens real sockets against a migrated disposable application database. */
beforeEach(async () => {
	database = await createGeneratedTestDatabase('starter_rooms');
	application = createApplication(config, { db: database.db });
	await application.db.migrations.migrate();
	server = await createServer(application, config);
	address = (await server.listen({ host: config.host, port: 0 })).replace('http:', 'ws:');
});
/** Closes only test-owned connections, listeners and database. */
afterEach(async () => {
	for (const client of clients.splice(0)) client.terminate();
	try { await server?.close(); } finally { try { await application?.close(); } finally { await database?.destroy(); } }
});
/** Registers through the real HTTP session flow. */
async function register(email = 'ada@example.test') {
	const response = await server.inject({ method: 'POST', url: '/api/register', headers: { origin: config.origin }, payload: { name: 'Ada', email, password: 'a-good-password-123' } });
	expect(response.statusCode).toBe(201);
	return String(response.headers['set-cookie']).split(';')[0];
}
/** Captures protocol frames before opening, including fast denial responses. */
async function connect(path = '/ws/rooms/lobby', cookie = '') {
	const ws = new WebSocket(address + path, { origin: config.origin, headers: { cookie } });
	clients.push(ws);
	const frames: any[] = [];
	let code = 0;
	ws.on('message', data => { const frame = JSON.parse(data.toString()); if (frame.type === 'message') frames.push(frame.data); });
	ws.on('close', value => { code = value; });
	await once(ws, 'open');
	ws.send(JSON.stringify({ type: path.endsWith('/lobby') ? 'connect' : 'authenticate' }));
	return { ws, frames, closed: () => code, send: (data: unknown) => ws.send(JSON.stringify({ type: 'message', data })) };
}
/** Waits for the application history boundary, not merely transport readiness. */
async function ready(client: Awaited<ReturnType<typeof connect>>) { await expect.poll(() => client.frames.some(frame => frame.type === 'history-end')).toBe(true); }

it('shares public chat, cursors and presence, removes departed tabs, and restores committed drawings after API replacement', async () => {
	const alice = await connect(); const bob = await connect();
	await Promise.all([ready(alice), ready(bob)]);
	await expect.poll(() => alice.frames.filter(frame => frame.type === 'presence').at(-1)?.participants.length).toBe(2);
	expect(alice.frames.filter(frame => frame.type === 'presence').at(-1).participants.every((member: any) => member.userId === null)).toBe(true);
	alice.send({ type: 'profile', name: 'Painter', color: '#ff0000' });
	alice.send({ type: 'chat', text: 'Hello room' });
	alice.send({ type: 'cursor', point: { x: 0.4, y: 0.2 } });
	alice.send({ type: 'stroke', color: '#ff0000', points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.7 }] });
	await expect.poll(() => bob.frames.some(frame => frame.type === 'stroke')).toBe(true);
	expect(bob.frames.find(frame => frame.type === 'chat').message).toMatchObject({ author: 'Painter', text: 'Hello room' });
	expect(bob.frames.find(frame => frame.type === 'cursor').point).toEqual({ x: 0.4, y: 0.2 });
	alice.ws.close();
	await expect.poll(() => bob.frames.some(frame => frame.type === 'left' && frame.name === 'Painter')).toBe(true);
	await expect.poll(() => bob.frames.filter(frame => frame.type === 'presence').at(-1)?.participants.length).toBe(1);
	await server.close();
	server = await createServer(application, config);
	address = (await server.listen({ host: config.host, port: 0 })).replace('http:', 'ws:');
	const returning = await connect(); await ready(returning);
	expect(returning.frames.filter(frame => frame.type === 'stroke')).toHaveLength(1);
	expect(returning.frames.find(frame => frame.type === 'chat').message.text).toBe('Hello room');
});

it('separates public, signed-in and explicitly gated rooms and rejects invalid commands', async () => {
	const cookie = await register();
	const denied = await connect('/ws/rooms/members');
	await expect.poll(denied.closed).toBe(4401);
	const gated = await connect('/ws/rooms/studio', cookie);
	await expect.poll(gated.closed).toBe(4403);
	const headers = { cookie, origin: config.origin };
	expect((await server.inject({ method: 'POST', url: '/api/rooms/studio/join', headers, payload: { code: 'wrong' } })).statusCode).toBe(403);
	expect((await server.inject({ method: 'POST', url: '/api/rooms/studio/join', headers, payload: { code: process.env.DEMO_ROOM_CODE ?? 'draw-together' } })).statusCode).toBe(200);
	const studio = await connect('/ws/rooms/studio', cookie); await ready(studio);
	const lobby = await connect('/ws/rooms/lobby', cookie); await ready(lobby);
	studio.send({ type: 'chat', text: 'Private studio message' });
	await expect.poll(() => studio.frames.some(frame => frame.type === 'chat')).toBe(true);
	expect(lobby.frames.some(frame => frame.type === 'chat')).toBe(false);
	expect(lobby.frames.filter(frame => frame.type === 'presence').at(-1).participants[0].userId).toBeNull();
	lobby.send({ type: 'stroke', color: '#ff0000', points: [{ x: -1, y: 0 }, { x: 1, y: 1 }] });
	await expect.poll(lobby.closed).toBe(1008);
});

it('delivers inbox invalidations only to the authenticated recipient and revokes logged-out sockets', async () => {
	const cookie = await register(); const stranger = await register('bob@example.test');
	const owner = await connect('/ws/inbox', cookie); const other = await connect('/ws/inbox', stranger);
	await expect.poll(() => owner.frames.length).toBe(1);
	await expect.poll(() => other.frames.length).toBe(1);
	const response = await server.inject({ method: 'POST', url: '/api/inbox/demo', headers: { cookie, origin: config.origin }, payload: { presentation: 'inbox' } });
	expect(response.statusCode).toBe(201);
	await expect.poll(() => owner.frames.length).toBe(2);
	expect(other.frames).toHaveLength(1);
	await server.inject({ method: 'POST', url: '/api/logout', headers: { cookie, origin: config.origin } });
	owner.send({ type: 'anything' });
	await expect.poll(owner.closed).toBe(4401);
});
