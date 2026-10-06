import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { InAppRecord } from '@db3.ai/app/in-app';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { App } from '@db3.ai/app/server';
import { AuthToken, UserIdentity } from '@db3.ai/app/auth';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { defineChannel, defineWebSocket, type WebSocketContext, type WebSocketOptions } from '@db3.ai/app/websocket';
import { registerWebSockets } from '@db3.ai/app/websocket/fastify';
import { WebSocketClient, type WebSocketClientState } from '@db3.ai/app/websocket/client';
import { resourceChannels } from '../examples/resourceChannels';
import { userEndpoint } from '../examples/userEndpoint';
import { deploymentEndpoint } from '../examples/deploymentEndpoint';

const origin = 'http://app.example.test';
let database: GeneratedTestDatabase;
let application: App;
let server: FastifyInstance;
let url: string;
let token: string;
let otherToken: string;
let user: UserIdentity;
let counter = 0;
const clients: WebSocket[] = [];
const browserClients: WebSocketClient[] = [];

beforeAll(async () => { database = await createGeneratedTestDatabase('websocket'); });
beforeEach(async () => {
	application = new App({ db: database.db });
	await application.db.install(UserIdentity, AuthToken);
	user = UserIdentity.create({ name: 'Alice', email: `alice-${counter++}@example.test` });
	await user.save();
	const other = UserIdentity.create({ name: 'Bob', email: `bob-${counter++}@example.test` });
	await other.save();
	token = (await application.auth.createToken(user)).token;
	otherToken = (await application.auth.createToken(other)).token;
});
afterEach(async () => {
	for (const client of browserClients.splice(0)) client.close();
	for (const client of clients.splice(0)) { if (client.readyState !== WebSocket.CLOSED) client.terminate(); }
	try { await server?.close(); } finally { await application?.close(); }
});
afterAll(async () => { await database?.destroy(); });

/** Opens an owned listener on an ephemeral port with short bounded cleanup. */
async function start(options: Partial<WebSocketOptions> = {}, port = 0): Promise<void> {
	server = Fastify();
	registerWebSockets(server, { app: application, origins: [origin], shutdownTimeoutMs: 100, endpoints: { '/ws/me': userEndpoint(application) }, ...options });
	url = (await server.listen({ host: '127.0.0.1', port })).replace('http:', 'ws:') + '/ws/me';
}

/** Captures all frames before connecting to avoid event-wait races. */
async function connect(credential: string | null = token, target = url) {
	const ws = new WebSocket(target, { origin });
	clients.push(ws);
	const frames: any[] = [];
	let closeCode = 0;
	ws.on('message', value => frames.push(JSON.parse(value.toString())));
	ws.on('error', () => {});
	ws.on('close', code => { closeCode = code; });
	await once(ws, 'open');
	if (credential !== null) ws.send(JSON.stringify({ type: 'authenticate', token: credential }));
	return { ws, frames, closed: () => closeCode };
}

/** Waits on observable protocol state with a deadline, never a fixed sleep. */
async function ready(client: Awaited<ReturnType<typeof connect>>) {
	await expect.poll(() => client.frames.some(frame => frame.type === 'ready')).toBe(true);
}

describe('authenticated WebSocket endpoints', () => {
	it('supports explicit anonymous endpoints and server-owned isolated channels', async () => {
		await start({ endpoints: { '/ws/me': defineWebSocket({ auth: 'public', async open(context) {
			const identity: null = context.user;
			expect(identity).toBeNull(); expect(context.userId).toBeNull();
			const leave = application.webSockets.channels.join('public', context);
			expect(application.webSockets.channels.join('public', context)).toBe(leave);
			await context.send({ anonymous: true });
		} }) } });
		const guest = await connect(null);
		guest.ws.send(JSON.stringify({ type: 'connect' }));
		await ready(guest);
		await expect.poll(() => guest.frames.length).toBe(2);
		expect(await application.webSockets.channels.publish('private', { secret: true })).toBe(0);
		expect(await application.webSockets.channels.publish('public', { hello: true })).toBe(1);
		guest.ws.close(1000); await expect.poll(guest.closed).toBe(1000);
		expect(await application.webSockets.channels.publish('public', { hello: true })).toBe(0);
	});

	it('uses a server token resolver instead of trusting a supplied bearer frame', async () => {
		await start({ resolveToken: () => token });
		const client = await connect(otherToken); await ready(client);
		await expect.poll(() => client.frames.length).toBe(2);
		expect(client.frames[1].data.userId).toBe(user.id);
	});

	it('never falls back to a bearer frame when the cookie resolver rejects authentication', async () => {
		await start({ resolveToken: () => null });
		const client = await connect(token);
		await expect.poll(client.closed).toBe(4401);
		expect(client.frames).toEqual([]);
	});
	it('runs controller actions with isolated identities and the shipped example', async () => {
		await start();
		const alice = await connect();
		const bob = await connect(otherToken);
		await expect.poll(() => alice.frames.length).toBe(2);
		await expect.poll(() => bob.frames.length).toBe(2);
		expect(alice.frames[1]).toEqual({ type: 'message', data: { type: 'hello', userId: user.id } });
		expect(bob.frames[1].data.userId).not.toBe(user.id);
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'ping' } }));
		await expect.poll(() => alice.frames.at(-1)).toEqual({ type: 'message', data: { type: 'pong' } });
		expect(bob.frames).toHaveLength(2);
	});

	it('counts multiple tabs once per user and removes presence after the last disconnect', async () => {
		await start();
		const changes: number[] = [];
		const unsubscribe = application.webSockets.onPresence('/ws/me', () => {
			expect(application.auth.user).toBeNull();
			changes.push(application.webSockets.presence('/ws/me').reduce((sum, item) => sum + item.connections, 0));
		});
		const first = await connect(); const second = await connect(); const other = await connect(otherToken);
		await Promise.all([ready(first), ready(second), ready(other)]);
		expect(application.webSockets.presence('/ws/me').find(item => item.userId === user.id)?.connections).toBe(2);
		expect(application.webSockets.presence('/unrelated')).toEqual([]);
		first.ws.close();
		await expect.poll(() => application.webSockets.presence('/ws/me').find(item => item.userId === user.id)?.connections).toBe(1);
		second.ws.close();
		await expect.poll(() => application.webSockets.presence('/ws/me').some(item => item.userId === user.id)).toBe(false);
		expect(changes).toEqual([1, 2, 3, 2, 1]);
		unsubscribe(); unsubscribe(); other.ws.close();
		await expect.poll(() => application.webSockets.presence('/ws/me').length).toBe(0);
		expect(changes).toHaveLength(5);
	});

	it.each(['wrong-token', ''])('rejects invalid authentication without running actions: %s', async credential => {
		await start(); const client = await connect(credential);
		await expect.poll(client.closed).toBe(4401);
		expect(client.frames).toEqual([]);
		expect(application.webSockets.presence('/ws/me')).toEqual([]);
	});

	it('bounds unauthenticated idle sockets and rejects commands before login', async () => {
		await start({ authTimeoutMs: 50 });
		const idle = await connect(null); const early = await connect(null);
		early.ws.send(JSON.stringify({ type: 'message', data: {} }));
		await expect.poll(early.closed).toBe(4401);
		await expect.poll(idle.closed).toBe(4401);
		expect(idle.frames).toEqual([]);
	});

	it('rejects forbidden and missing origins before upgrading', async () => {
		await start();
		for (const supplied of ['http://evil.example', undefined]) {
			const ws = new WebSocket(url, { origin: supplied }); clients.push(ws);
			ws.on('error', () => {});
			const [request, response] = await once(ws, 'unexpected-response');
			expect(response.statusCode).toBe(403);
			response.resume(); request.destroy();
		}
	});

	it('runs resource policy and Auth freshly for each action and server send', async () => {
		let allowed = true; let context: WebSocketContext | undefined;
		await start({ endpoints: { '/ws/me': defineWebSocket({ authorize: () => allowed, open: value => { context = value; }, message: async ({ userId, send }) => { expect(application.auth.user?.id).toBe(userId); await send(userId); } }) } });
		const client = await connect(); await ready(client);
		allowed = false;
		expect(await context!.send({ secret: true })).toBe(false);
		await expect.poll(client.closed).toBe(4403);
		expect(client.frames).toEqual([{ type: 'ready' }]);
	});

	it('rejects revoked sessions on idle revalidation', async () => {
		await start({ heartbeatMs: 40 }); const client = await connect(); await ready(client);
		await application.auth.revokeAllTokens(user);
		await expect.poll(client.closed).toBe(4401);
	});

	it('rejects expired sessions and resource policies before opening', async () => {
		const expired = await application.auth.createToken(user, { expiresAt: new Date('2020-01-01T00:00:00Z') });
		await start({ endpoints: { '/ws/me': defineWebSocket({ authorize: () => false }) } });
		const first = await connect(expired.token); const second = await connect();
		await expect.poll(first.closed).toBe(4401);
		await expect.poll(second.closed).toBe(4403);
		expect(first.frames.concat(second.frames)).toEqual([]);
	});

	it('validates JSON, binary, command schemas and oversized frames', async () => {
		await start({ maxPayloadBytes: 256 });
		const cases: Array<[string | Buffer, number]> = [['{broken', 1007], [Buffer.from('binary'), 1003], [JSON.stringify({ type: 'message', data: { type: 'unknown' } }), 1008], ['x'.repeat(300), 1009]];
		for (const [frame, code] of cases) {
			const client = await connect(); await ready(client); client.ws.send(frame);
			await expect.poll(client.closed).toBe(code);
		}
	});

	it('bounds outbound frames for slow clients', async () => {
		await start({ maxBufferedBytes: 100, endpoints: { '/ws/me': defineWebSocket({ open: async ({ send }) => { await send('x'.repeat(200)); } }) } });
		const client = await connect(); await expect.poll(client.closed).toBe(1009);
	});

	it('bounds pending send authorization and removes subscriptions on overload', async () => {
		let context: WebSocketContext | undefined;
		let checks = 0;
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		await start({ maxPendingSends: 2, endpoints: { '/ws/me': defineWebSocket({ open: value => {
			context = value;
			application.webSockets.channels.join('slow', value);
		} }) } });
		const client = await connect(); await ready(client);
		/** Holds real authenticated sends at an application policy boundary. */
		const authorize = async () => { checks++; await gate; return true; };
		const pending = [context!.send({ page: 1 }, authorize), context!.send({ page: 2 }, authorize)];
		try {
			await expect.poll(() => checks).toBe(2);
			expect(await context!.send({ page: 3 }, authorize)).toBe(false);
			await expect.poll(client.closed).toBe(1013);
			for (let index = 0; index < 100; index++) expect(await context!.send({ page: index }, authorize)).toBe(false);
			expect(checks).toBe(2);
			expect(await application.webSockets.channels.publish('slow', {})).toBe(0);
			expect(application.webSockets.presence('/ws/me')).toEqual([]);
		} finally { release(); await Promise.all(pending); }
		expect(await Promise.all(pending)).toEqual([false, false]);
		expect(client.frames).toEqual([{ type: 'ready' }]);
	});

	it('releases pending send capacity after delivery without throttling later events', async () => {
		let context: WebSocketContext | undefined;
		await start({ maxPendingSends: 2, endpoints: { '/ws/me': defineWebSocket({ open: value => { context = value; } }) } });
		const client = await connect(); await ready(client);
		for (let index = 0; index < 10; index += 2) {
			expect(await Promise.all([context!.send({ page: index }), context!.send({ page: index + 1 })])).toEqual([true, true]);
		}
		await expect.poll(() => client.frames.filter(frame => frame.type === 'message').length).toBe(10);
		expect(client.frames.filter(frame => frame.type === 'message').map(frame => frame.data.page).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(client.closed()).toBe(0);
	});

	it('bounds queued inbound actions and cancels their application subscriptions', async () => {
		let release!: () => void;
		let running = false;
		await start({ maxPendingMessages: 2, endpoints: { '/ws/me': defineWebSocket({ message: async ({ signal }) => {
			running = true;
			await new Promise<void>(resolve => { release = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
		} }) } });
		const client = await connect(); await ready(client);
		client.ws.send(JSON.stringify({ type: 'message', data: 1 }));
		await expect.poll(() => running).toBe(true);
		for (let index = 0; index < 4; index++) client.ws.send(JSON.stringify({ type: 'message', data: index }));
		await expect.poll(client.closed).toBe(1008);
		release();
	});

	it('reserves connection capacity before authentication', async () => {
		await start({ maxConnections: 1 }); await connect(null);
		const rejected = new WebSocket(url, { origin }); clients.push(rejected);
		rejected.on('error', () => {});
		const [request, response] = await once(rejected, 'unexpected-response');
		expect(response.statusCode).toBe(403); response.resume(); request.destroy();
	});

	it('denies a retained server send after revocation', async () => {
		let context: WebSocketContext | undefined;
		await start({ endpoints: { '/ws/me': defineWebSocket({ open: value => { context = value; } }) } });
		const client = await connect(); await ready(client);
		await application.auth.revokeAllTokens(user);
		expect(await context!.send('private')).toBe(false);
		await expect.poll(client.closed).toBe(4401);
		expect(client.frames).toEqual([{ type: 'ready' }]);
	});

	it('terminates dead peers that no longer respond to heartbeats', async () => {
		await start({ heartbeatMs: 30 });
		const ws = new WebSocket(url, { origin, autoPong: false }); clients.push(ws);
		ws.on('error', () => {}); const closed = once(ws, 'close');
		await once(ws, 'open'); ws.send(JSON.stringify({ type: 'authenticate', token }));
		const [code] = await closed; expect(code).toBe(1011);
	});

	it('bounds shutdown even when application cleanup is stuck', async () => {
		let finish!: () => void;
		await start({ shutdownTimeoutMs: 20, endpoints: { '/ws/me': defineWebSocket({ close: () => new Promise<void>(resolve => { finish = resolve; }) }) } });
		const client = await connect(); await ready(client);
		await server.close();
		expect(application.webSockets.presence('/ws/me')).toEqual([]);
		finish();
	});

	it('cleans up subscriptions and upgrade handlers when Fastify closes', async () => {
		let cleaned = 0;
		await start({ endpoints: { '/ws/me': defineWebSocket({ close: () => { cleaned++; } }) } });
		const client = await connect(); await ready(client);
		await server.close();
		await expect.poll(client.closed).toBe(1001);
		expect(cleaned).toBe(1);
		expect(server.server.listenerCount('upgrade')).toBe(0);
		expect(application.webSockets.presence('/ws/me')).toEqual([]);
		await application.webSockets.close();
	});

	it('contains action failures and continues serving unrelated connections', async () => {
		const errors: unknown[] = [];
		await start({ onError: error => errors.push(error), endpoints: { '/ws/me': defineWebSocket({ message: () => { throw new Error('private failure'); } }) } });
		const client = await connect(); await ready(client);
		client.ws.send(JSON.stringify({ type: 'message', data: 'fail' }));
		await expect.poll(client.closed).toBe(1011);
		expect(errors).toHaveLength(1); expect(JSON.stringify(client.frames)).not.toContain('private failure');
		await ready(await connect(otherToken));
	});
});

describe('framework browser client against a real server', () => {
	it('reconnects across API replacement using the same persisted Auth session', async () => {
		await start(); const port = Number(new URL(url).port);
		const messages: unknown[] = []; const states: WebSocketClientState[] = [];
		const client = new WebSocketClient({ url, token: () => token, maxReconnectDelayMs: 20, createSocket: target => new WebSocket(target, { origin }), onMessage: data => messages.push(data), onState: state => states.push(state) });
		browserClients.push(client); client.connect();
		await expect.poll(() => messages.length).toBe(1);
		expect(client.send({ type: 'ping' })).toBe(true);
		await expect.poll(() => messages.length).toBe(2);
		await server.close(); await application.close();
		application = new App({ db: database.db }); await start({}, port);
		await expect.poll(() => messages.length).toBe(3);
		expect(states).toContain('reconnecting');
		expect(messages[2]).toEqual({ type: 'hello', userId: user.id });
		client.close(); expect(client.send({ type: 'ping' })).toBe(false);
		expect(client.state).toBe('closed');
	});

	it('stops on invalid credentials and allows explicit retry after token refresh', async () => {
		await start(); let credential = 'invalid';
		const client = new WebSocketClient({ url, token: () => credential, createSocket: target => new WebSocket(target, { origin }), onMessage: () => {} });
		browserClients.push(client); client.connect();
		await expect.poll(() => client.state).toBe('denied');
		credential = token; client.connect();
		await expect.poll(() => client.state).toBe('connected');
	});

	it('cancels an unresolved credential request without opening a late socket', async () => {
		let resolve!: (value: string) => void;
		const client = new WebSocketClient({ url: 'ws://localhost/ws/me', token: () => new Promise<string>(done => { resolve = done; }), onMessage: () => {}, createSocket: () => { throw new Error('Must not connect'); } });
		browserClients.push(client); client.connect(); client.close(); resolve(token);
		await Promise.resolve(); expect(client.state).toBe('closed');
	});
});


describe('authorized channels on one connection', () => {
	it('isolates website subscriptions, denies unknown channels and rechecks revoked resource access', async () => {
		let allowed = true;
		await start({ endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('website:{websiteId}:jobs', {
			/** Represents an application-owned website membership policy. */
			authorize: context => allowed && context.userId === user.id && context.params.websiteId === 'first',
		})] }) } });
		const alice = await connect(); const bob = await connect(otherToken);
		await ready(alice); await ready(bob);
		for (const client of [alice, bob]) client.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:first:jobs' } }));
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:second:jobs' } }));
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'unknown' } }));
		await expect.poll(() => alice.frames.length).toBe(4);
		await expect.poll(() => bob.frames.length).toBe(2);
		expect(bob.frames[1].data.type).toBe('channel.denied');
		expect(alice.frames.slice(2).every(frame => frame.data.type === 'channel.denied')).toBe(true);
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', { jobId: 'one' })).toBe(1);
		await expect.poll(() => alice.frames.length).toBe(5);
		expect(alice.frames[4].data).toEqual({ type: 'channel.event', channel: 'website:first:jobs', event: 'completed', data: { jobId: 'one' } });
		expect(bob.frames.length).toBe(2);
		allowed = false;
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', { jobId: 'secret' })).toBe(0);
		allowed = true;
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', { jobId: 'still-unsubscribed' })).toBe(0);
	});

	it('shares a physical connection, routes events and cleans up individual listeners', async () => {
		await start({ endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('website:{websiteId}:jobs', { authorize: ({ userId }) => userId === user.id })] }) } });
		let connections = 0;
		const subscriptions: string[] = []; const denied: string[] = []; const first: unknown[] = []; const second: unknown[] = [];
		const client = new WebSocketClient({ url, token: () => token, onSubscribed: name => subscriptions.push(name), onChannelDenied: name => denied.push(name), createSocket: target => { connections++; return new WebSocket(target, { origin }); } });
		browserClients.push(client);
		const removeFirst = client.channel('website:first:jobs').on('completed', data => first.push(data));
		const removeSecond = client.channel('website:second:jobs').on('completed', data => second.push(data));
		const removeUnknown = client.channel('unknown').on('completed', () => { throw new Error('Denied channel received a payload'); });
		client.connect();
		await expect.poll(() => subscriptions.length).toBe(2);
		await expect.poll(() => denied).toEqual(['unknown']);
		expect(connections).toBe(1);
		await application.webSockets.channel('website:first:jobs').publish('completed', { id: 1 });
		await application.webSockets.channel('website:second:jobs').publish('completed', { id: 2 });
		await expect.poll(() => first).toEqual([{ id: 1 }]);
		await expect.poll(() => second).toEqual([{ id: 2 }]);
		removeFirst(); removeFirst();
		await expect.poll(() => application.webSockets.channel('website:first:jobs').publish('completed', { id: 3 })).toBe(0);
		expect(first).toHaveLength(1);
		expect(client.state).toBe('connected');
		removeSecond(); removeUnknown(); client.close();
		await expect.poll(() => application.webSockets.channel('website:second:jobs').publish('completed', {})).toBe(0);
	});

	it('resubscribes after reconnect and reauthorizes before accepting subscriptions', async () => {
		let allowed = true;
		const endpoint = resourceChannels(() => allowed);
		await start({ endpoints: { '/ws/me': endpoint } });
		const subscriptions: string[] = []; const denied: string[] = [];
		const client = new WebSocketClient({ url, token: () => token, maxReconnectDelayMs: 20, onSubscribed: name => subscriptions.push(name), onChannelDenied: name => denied.push(name), createSocket: target => new WebSocket(target, { origin }) });
		browserClients.push(client);
		client.channel('website:first:jobs').on('completed', () => {});
		client.connect();
		await expect.poll(() => subscriptions.length).toBe(1);
		const port = Number(new URL(url).port);
		await server.close();
		await start({ endpoints: { '/ws/me': endpoint } }, port);
		await expect.poll(() => subscriptions.length).toBe(2);
		allowed = false;
		await server.close();
		await start({ endpoints: { '/ws/me': endpoint } }, port);
		await expect.poll(() => denied.length).toBe(1);
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', {})).toBe(0);
	});

	it('does not deliver after unsubscribe while a resource check is still in flight', async () => {
		let block = false; let entered = false; let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		await start({ endpoints: { '/ws/me': resourceChannels(async () => { if (block) { entered = true; await gate; } return true; }) } });
		const alice = await connect(); await ready(alice);
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:first:jobs' } }));
		await expect.poll(() => alice.frames.length).toBe(2);
		block = true;
		const publishing = application.webSockets.channel('website:first:jobs').publish('completed', { secret: true });
		try {
			await expect.poll(() => entered).toBe(true);
			alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.unsubscribe', channel: 'website:first:jobs' } }));
			alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'unknown' } }));
			await expect.poll(() => alice.frames.length).toBe(3);
		} finally { release(); }
		expect(await publishing).toBe(0);
		expect(alice.frames).toHaveLength(3);
		expect(alice.frames[2].data.type).toBe('channel.denied');
	});

	it('rejects overlapping channel policies rather than choosing a permissive match', async () => {
		await start({ endpoints: { '/ws/me': defineWebSocket({ channels: [
			defineChannel('website:{id}:jobs', { authorize: () => true }),
			defineChannel('website:first:jobs', { authorize: () => false }),
		] }) } });
		const alice = await connect(); await ready(alice);
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:first:jobs' } }));
		await expect.poll(() => alice.frames.length).toBe(2);
		expect(alice.frames[1].data.type).toBe('channel.denied');
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', {})).toBe(0);
	});

	it('bounds subscriptions without flooding the server action queue and preserves duplicate listeners', async () => {
		await start({ endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('website:{id}:jobs', { authorize: () => true })] }) } });
		let subscribed = 0; const denied: string[] = []; const messages: unknown[] = [];
		const client = new WebSocketClient({ url, token: () => token, onSubscribed: () => { subscribed++; }, onChannelDenied: name => denied.push(name), createSocket: target => new WebSocket(target, { origin }) });
		browserClients.push(client);
		for (let id = 0; id < 129; id++) client.channel(`website:${id}:jobs`).on('completed', () => {});
		const listener = (data: unknown) => messages.push(data);
		const remove = client.channel('website:0:jobs').on('completed', listener);
		client.channel('website:0:jobs').on('completed', listener);
		client.connect();
		await expect.poll(() => subscribed, { timeout: 10000 }).toBe(128);
		await expect.poll(() => denied).toEqual(['website:128:jobs']);
		remove();
		await application.webSockets.channel('website:0:jobs').publish('completed', { remaining: true });
		await expect.poll(() => messages).toEqual([{ remaining: true }]);
		expect(client.state).toBe('connected');
	});

	it('rejects a revoked session before channel delivery even when resource policy permits it', async () => {
		await start({ endpoints: { '/ws/me': resourceChannels(() => true) } });
		const alice = await connect(); await ready(alice);
		alice.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:first:jobs' } }));
		await expect.poll(() => alice.frames.length).toBe(2);
		await application.auth.revokeAllTokens(user);
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', { secret: true })).toBe(0);
		await expect.poll(alice.closed).toBe(4401);
		expect(alice.frames).toHaveLength(2);
	});

	it('fails closed for anonymous subscription attempts and invalid patterns', async () => {
		const definition = defineChannel('website:{id}:jobs', { authorize: () => true });
		await start({ endpoints: { '/ws/me': defineWebSocket({ auth: 'public', channels: [definition] }) } });
		const guest = await connect(null);
		guest.ws.send(JSON.stringify({ type: 'connect' })); await ready(guest);
		guest.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:first:jobs' } }));
		await expect.poll(() => guest.frames.length).toBe(2);
		expect(guest.frames[1].data.type).toBe('channel.denied');
		expect(await application.webSockets.channel('website:first:jobs').publish('completed', {})).toBe(0);
		expect(() => defineChannel('website:{id}:{id}', { authorize: () => true })).toThrow();
	});
});


describe('authenticated HTTP worker publication', () => {
	const secret = 'a'.repeat(64);
	const path = '/_internal/realtime/publish';

	it('delivers a committed worker notification, isolates recipients and rechecks revoked access', async () => {
		await application.db.install(InAppRecord);
		let allowed = true;
		await start({ publish: { path, token: secret }, endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('user:{userId}:notifications', { authorize: context => allowed && context.userId === context.params.userId })] }) } });
		const alice = await connect(); const bob = await connect(otherToken);
		await Promise.all([ready(alice), ready(bob)]);
		const name = `user:${user.id}:notifications`;
		for (const client of [alice, bob]) client.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: name } }));
		await expect.poll(() => alice.frames.at(-1)?.data?.type).toBe('channel.subscribed');
		await expect.poll(() => bob.frames.at(-1)?.data?.type).toBe('channel.denied');
		/** Runs a child with disposable DB credentials over stdin, never on the command line. */
		async function worker(): Promise<void> {
			const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/publishNotification.ts', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
			const finished = once(child, 'exit');
			let diagnostics = ''; child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
			child.stdin.end(JSON.stringify({ database: { client: database.db.client.config.client, connection: { ...database.db.client.config.connection, password: database.db.client.config.connection.password } }, publish: { url: url.replace('ws:', 'http:').replace('/ws/me', path), token: secret }, userId: user.id }));
			const deadline = setTimeout(() => child.kill(), 10000);
			try { expect((await finished)[0], diagnostics).toBe(0); } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill(); }
		}
		await worker();
		await expect.poll(() => alice.frames.filter(frame => frame.data?.type === 'channel.event').length).toBe(1);
		expect(await InAppRecord.where('userId', user.id).count()).toBe(1);
		expect(bob.frames.some(frame => frame.data?.type === 'channel.event')).toBe(false);
		allowed = false;
		await worker();
		expect(alice.frames.filter(frame => frame.data?.type === 'channel.event')).toHaveLength(1);
	}, 30000);

	it('discards unattended HTTP bursts without database queries or replay, including after disconnect', async () => {
		let queries = 0;
		let accessChecks = 0;
		/** Counts SQL statements without retaining their contents. */
		const onQuery = () => { queries++; };
		await start({ publish: { path, token: secret }, endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('website:{websiteId}:jobs', { authorize: () => { accessChecks++; return true; } })] }) } });
		const target = url.replace('ws:', 'http:').replace('/ws/me', path);
		/** Exercises real authenticated HTTP requests while no channel viewers exist. */
		async function unattendedBurst(): Promise<void> {
			queries = 0;
			const previousChecks = accessChecks;
			database.db.on('query', onQuery);
			try {
				for (let batch = 0; batch < 40; batch++) {
					await Promise.all(Array.from({ length: 25 }, async (_, index) => {
						const response = await fetch(target, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ channel: `website:${batch * 25 + index}:jobs`, event: 'progress', data: { completed: index } }) });
						try { expect(response.status).toBe(204); } finally { await response.body?.cancel(); }
					}));
				}
				expect(queries).toBe(0);
				expect(accessChecks).toBe(previousChecks);
			} finally { database.db.removeListener('query', onQuery); }
		}
		await unattendedBurst();
		const client = await connect(); await ready(client);
		client.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'website:0:jobs' } }));
		await expect.poll(() => client.frames.at(-1)?.data?.type).toBe('channel.subscribed');
		expect(await application.webSockets.channel('website:0:jobs').publish('progress', { completed: 1000 })).toBe(1);
		await expect.poll(() => client.frames.at(-1)?.data?.data).toEqual({ completed: 1000 });
		expect(client.frames.filter(frame => frame.data?.type === 'channel.event')).toHaveLength(1);
		client.ws.close();
		await expect.poll(() => application.webSockets.presence('/ws/me')).toEqual([]);
		await unattendedBurst();
	}, 30000);

	it('requires service credentials, rejects browser requests and validates bounded payloads', async () => {
		await start({ publish: { path, token: secret } });
		const payload = { channel: 'account:updates', event: 'changed', data: {} };
		for (const headers of [{}, { authorization: `Bearer ${token}` }, { authorization: `Bearer ${secret}`, origin }, { authorization: 'Bearer wrong-secret' }]) {
			expect((await server.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(401);
		}
		const headers = { authorization: `Bearer ${secret}` };
		for (const invalid of [{ ...payload, channel: 'account/*' }, { ...payload, event: '' }, { event: 'changed' }, []]) {
			expect((await server.inject({ method: 'POST', url: path, headers, payload: invalid })).statusCode).toBe(400);
		}
		expect((await server.inject({ method: 'POST', url: path, headers, payload: { ...payload, data: 'x'.repeat(65536) } })).statusCode).toBe(413);
		expect((await server.inject({ method: 'POST', url: path, headers, payload })).statusCode).toBe(204);
	});

	it('uses local delivery on mounted APIs without recursively forwarding HTTP requests', async () => {
		await application.close();
		application = new App({ db: database.db, webSockets: { publish: { url: 'http://127.0.0.1:1/unreachable', token: secret } } });
		await start({ publish: { path, token: secret }, endpoints: { '/ws/me': defineWebSocket({ channels: [defineChannel('account:updates', { authorize: () => true })] }) } });
		const client = await connect(); await ready(client);
		client.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'account:updates' } }));
		await expect.poll(() => client.frames.at(-1)?.data?.type).toBe('channel.subscribed');
		expect(await application.webSockets.channel('account:updates').publish('changed', {})).toBe(1);
		expect((await server.inject({ method: 'POST', url: path, headers: { authorization: `Bearer ${secret}` }, payload: { channel: 'account:updates', event: 'changed' } })).statusCode).toBe(204);
		await expect.poll(() => client.frames.filter(frame => frame.data?.type === 'channel.event').length).toBe(2);
	});

	it('rejects unavailable endpoints, redirects and timeouts without retrying or leaking credentials', async () => {
		let requests = 0; let behavior = 'failure';
		const endpoint = createServer((_request, response) => {
			requests++;
			if (behavior === 'timeout') return;
			response.statusCode = behavior === 'redirect' ? 307 : 503;
			response.setHeader('location', 'http://127.0.0.1:1/never-follow'); response.end();
		});
		endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
		const address = endpoint.address() as { port: number };
		await application.close();
		application = new App({ db: database.db, webSockets: { publish: { url: `http://127.0.0.1:${address.port}${path}`, token: secret, timeoutMs: 100 } } });
		try {
			await expect(application.webSockets.channel('account:updates').publish('changed', {})).rejects.toThrow('503');
			behavior = 'redirect';
			await expect(application.webSockets.channel('account:updates').publish('changed', {})).rejects.toThrow();
			behavior = 'timeout';
			await expect(application.webSockets.channel('account:updates').publish('changed', {})).rejects.toThrow();
			expect(requests).toBe(3);
			const publisher = application.webSockets.channel('account:updates');
			await application.close();
			await expect(publisher.publish('changed', {})).rejects.toThrow('closed');
		} finally { endpoint.closeAllConnections(); await new Promise<void>(resolve => endpoint.close(() => resolve())); }
	});
});


describe('deployment progress channel example', () => {
	it('isolates environments and rechecks a viewer after permission revocation', async () => {
		let allowed = true;
		await start({ endpoints: { '/ws/me': deploymentEndpoint((userId, environmentId) => allowed && userId === user.id && environmentId === 'production') } });
		const viewer = await connect(); await ready(viewer);
		const outsider = await connect(otherToken); await ready(outsider);
		viewer.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'environment:production:deployments' } }));
		outsider.ws.send(JSON.stringify({ type: 'message', data: { type: 'channel.subscribe', channel: 'environment:production:deployments' } }));
		await expect.poll(() => viewer.frames.at(-1)?.data?.type).toBe('channel.subscribed');
		await expect.poll(() => outsider.frames.at(-1)?.data?.type).toBe('channel.denied');
		expect(await application.webSockets.channel('environment:staging:deployments').publish('changed', { deploymentId: 'deploy-other' })).toBe(0);
		expect(await application.webSockets.channel('environment:production:deployments').publish('changed', { deploymentId: 'deploy-1', revision: 2 })).toBe(1);
		await expect.poll(() => viewer.frames.at(-1)?.data?.event).toBe('changed');
		allowed = false;
		expect(await application.webSockets.channel('environment:production:deployments').publish('changed', { deploymentId: 'deploy-1', revision: 3 })).toBe(0);
	});
});
