import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { createPinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { App } from '@db3.ai/app/server';
import { AuthToken, UserIdentity } from '@db3.ai/app/auth';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { registerWebSockets } from '@db3.ai/app/websocket/fastify';
import { LiveBoard } from '../../examples/board/LiveBoard';
import { SummarizeBoardJob } from '../../examples/board/SummarizeBoardJob';
import { createBoardStore, type BoardApi } from '../../examples/board/createBoardStore';
import { registerBoardRoutes } from '../../examples/board/registerBoardRoutes';
import { createBoardClient } from '../../examples/board/createBoardClient';
import { createChannelSync } from '../../examples/createChannelSync';

let database: GeneratedTestDatabase;
let application: App;
let server: FastifyInstance;
let base: string;
let board: LiveBoard;
let alice: UserIdentity;
let bob: UserIdentity;
let aliceToken: string;
let bobToken: string;
let outsiderToken: string;
const sessions: ReturnType<typeof createChannelSync>[] = [];
const origin = 'http://board.example.test';
const secret = 'example-service-secret-for-board-tests-12345';

beforeAll(async () => { database = await createGeneratedTestDatabase('live_board'); });
beforeEach(async () => {
	application = new App({ db: database.db, log: { enabled: false }, queue: { driver: 'database', queueMonitor: false } });
	await application.db.install(LiveBoard, UserIdentity, AuthToken, QueuedJob, FailedJob);
	await QueuedJob.query().delete();
	alice = UserIdentity.create({ name: 'Alice', email: `${randomUUID()}@example.test` }); await alice.save();
	bob = UserIdentity.create({ name: 'Bob', email: `${randomUUID()}@example.test` }); await bob.save();
	const outsider = UserIdentity.create({ name: 'Outsider', email: `${randomUUID()}@example.test` }); await outsider.save();
	aliceToken = (await application.auth.createToken(alice)).token;
	bobToken = (await application.auth.createToken(bob)).token;
	outsiderToken = (await application.auth.createToken(outsider)).token;
	board = LiveBoard.create({ members: [alice.id, bob.id], cards: [{ id: 'card-1', title: 'Ship live board', column: 'todo' }], revision: 0, activity: null }); await board.save();
	server = Fastify();
	registerBoardRoutes(server, application);
	registerWebSockets(server, { app: application, origins: [origin], endpoints: { '/ws': LiveBoard.endpoint() }, publish: { path: '/internal/publish', token: secret }, shutdownTimeoutMs: 100 });
	base = await server.listen({ host: '127.0.0.1', port: 0 });
});
afterEach(async () => {
	for (const session of sessions.splice(0)) session.close();
	try { await server?.close(); } finally { await application?.close(); }
});
afterAll(async () => { await database?.destroy(); });

/** Exercises real authenticated HTTP, sockets and Pinia, with one isolated browser store per viewer. */
function viewer(token: string) {
	let sockets = 0;
	const view = createBoardClient({ baseUrl: base, boardId: board.id, pinia: createPinia(), token: () => token,
		createSocket: url => { sockets++; return new WebSocket(url, { origin }) as never; },
	});
	sessions.push(view.sync);
	return { ...view, sockets: () => sockets };
}

it('syncs another user’s saved card into Pinia and rejects stale edits and foreign access', async () => {
	const first = viewer(aliceToken); const second = viewer(bobToken); const foreign = viewer(outsiderToken);
	await expect.poll(() => first.store.snapshot?.revision).toBe(0);
	await expect.poll(() => second.store.snapshot?.revision).toBe(0);
	await expect.poll(() => foreign.store.error).not.toBeNull();
	await first.store.move('card-1', 'done');
	await expect.poll(() => second.store.snapshot?.cards[0]?.column).toBe('done');
	expect(second.sockets()).toBe(1);
	expect(foreign.store.snapshot).toBeNull();
	await expect(second.api.move({ cardId: 'card-1', column: 'doing', revision: 0 })).rejects.toThrow('409');
	expect((await LiveBoard.snapshot(board.id, String(alice.id))).cards[0]?.column).toBe('done');
	await expect(foreign.api.move({ cardId: 'card-1', column: 'doing', revision: 1 })).rejects.toThrow('404');
});

it('restores loading after a full client reload, completes through a separate worker App and catches up offline', async () => {
	const first = viewer(aliceToken);
	await expect.poll(() => first.store.snapshot?.revision).toBe(0);
	const runId = randomUUID();
	const request = first.store.start(runId);
	expect(first.store.busy).toBe(true);
	await request;
	expect(first.store.snapshot?.activity?.status).toBe('queued');
	first.sync.close();
	const reloaded = viewer(aliceToken);
	await expect.poll(() => reloaded.store.busy).toBe(true);
	await reloaded.api.start(runId);
	expect(await QueuedJob.query().count()).toBe(1);
	const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/processBoardJob.ts', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
	const finished = once(child, 'exit');
	let diagnostics = ''; child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
	child.stdin.end(JSON.stringify({ database: { client: database.db.client.config.client, connection: { ...database.db.client.config.connection, password: database.db.client.config.connection.password } }, publish: { url: `${base}/internal/publish`, token: secret } }));
	const deadline = setTimeout(() => child.kill(), 15000);
	try { expect((await finished)[0], diagnostics).toBe(0); }
	finally { clearTimeout(deadline); if (child.exitCode === null) child.kill(); }
	await expect.poll(() => reloaded.store.snapshot?.activity?.status).toBe('completed');
	expect(reloaded.store.busy).toBe(false);
	expect(reloaded.store.snapshot?.activity?.result).toBe('0 of 1 cards complete');
	// No event delivery is needed to recover a completed run after the browser was closed.
	reloaded.sync.close();
	const later = viewer(aliceToken);
	await expect.poll(() => later.store.snapshot?.activity?.status).toBe('completed');
	expect(later.store.busy).toBe(false);
}, 30000);

it('reloads missed changes after reconnect and never opens a second socket for another binding', async () => {
	const view = viewer(aliceToken);
	await expect.poll(() => view.store.snapshot?.revision).toBe(0);
	const extra = view.sync.watch(`board:${board.id}`, view.api.read, () => {}, () => {});
	expect(view.sockets()).toBe(1);
	extra.stop();
	view.sync.client.close();
	await application.requestContext.run(() => LiveBoard.move(board.id, String(bob.id), { cardId: 'card-1', column: 'doing', revision: 0 }));
	view.sync.client.connect();
	await expect.poll(() => view.store.snapshot?.cards[0]?.column).toBe('doing');
	expect(view.sockets()).toBe(2); // Replacement after close, never two concurrent connections.
});

it('rejects revoked subscriptions, persists terminal job failure and fences an old job', async () => {
	const view = viewer(bobToken);
	await expect.poll(() => view.store.snapshot?.revision).toBe(0);
	const runId = randomUUID();
	await view.api.start(runId);
	board = (await LiveBoard.where('id', board.id).firstOrFail());
	board.members = [String(alice.id)]; await board.save();
	application.queue.registerJob(SummarizeBoardJob);
	expect((await application.queue.workNextJob('boards'))?.status).toBe('failed');
	expect((await LiveBoard.snapshot(board.id, String(alice.id))).activity?.status).toBe('failed');
	view.sync.client.close(); view.sync.client.connect();
	await expect.poll(() => view.store.snapshot).toBeNull();
	const newer = await LiveBoard.startSummary(board.id, String(alice.id), randomUUID());
	await new SummarizeBoardJob({ boardId: board.id, userId: String(bob.id), runId }).onFinalFailure();
	expect((await LiveBoard.snapshot(board.id, String(alice.id))).activity).toEqual(newer.activity);
});

it('rolls back loading and queue insertion together and rejects malformed payloads', async () => {
	// A real SQL dispatch failure must roll the visible loading state back too.
	await database.db.schema.renameTable('jobs', 'unavailable_jobs');
	try { await expect(LiveBoard.startSummary(board.id, String(alice.id), randomUUID())).rejects.toThrow(); }
	finally { await database.db.schema.renameTable('unavailable_jobs', 'jobs'); }
	expect(await QueuedJob.query().count()).toBe(0);
	expect((await LiveBoard.snapshot(board.id, String(alice.id))).activity).toBeNull();
	await expect(LiveBoard.move(board.id, String(alice.id), { cardId: 'card-1', column: 'invalid', revision: 0 })).rejects.toThrow();
});


it('coalesces invalidations during a snapshot load, ignores old revisions and fences disposal', async () => {
	const initial = await LiveBoard.snapshot(board.id, String(alice.id));
	const store = createBoardStore(board.id, {} as BoardApi)(createPinia());
	store.apply({ ...initial, revision: 5 });
	store.apply(initial);
	expect(store.snapshot?.revision).toBe(5);
	const sync = createChannelSync({ url: base.replace('http:', 'ws:') + '/ws', token: () => aliceToken });
	sessions.push(sync);
	const releases: Array<(value: number) => void> = [];
	const applied: number[] = [];
	const binding = sync.watch(`board:${board.id}`, () => new Promise<number>(resolve => { releases.push(resolve); }), value => { applied.push(value); }, () => {});
	const pending = binding.refresh();
	void binding.refresh();
	await expect.poll(() => releases.length).toBe(1);
	releases[0]!(1);
	await expect.poll(() => releases.length).toBe(2);
	expect(applied).toEqual([1]);
	binding.stop();
	releases[1]!(2);
	await pending;
	expect(applied).toEqual([1]);
});


it('does not repopulate private Pinia state from a mutation response after logout', async () => {
	const initial = await LiveBoard.snapshot(board.id, String(alice.id));
	let complete!: (value: unknown) => void;
	const store = createBoardStore(board.id, { read: async () => initial, move: async () => initial, start: () => new Promise(resolve => { complete = resolve; }) })(createPinia());
	store.apply(initial);
	const pending = store.start(randomUUID());
	expect(store.busy).toBe(true);
	store.dispose();
	complete({ ...initial, revision: 1 });
	await pending;
	expect(store.snapshot).toBeNull();
	expect(store.busy).toBe(false);
});


it('keeps a single active job under concurrent starts and allows explicit snapshot retry after a synchronous error', async () => {
	const [first, second] = await Promise.all([
		LiveBoard.startSummary(board.id, String(alice.id), randomUUID()),
		LiveBoard.startSummary(board.id, String(bob.id), randomUUID()),
	]);
	expect(first.activity?.id).toBe(second.activity?.id);
	expect(await QueuedJob.query().count()).toBe(1);
	const sync = createChannelSync({ url: base.replace('http:', 'ws:') + '/ws' });
	sessions.push(sync);
	let attempt = 0;
	const errors: unknown[] = [];
	const applied: number[] = [];
	const binding = sync.watch(`board:${board.id}`, () => {
		if (++attempt === 1) throw new Error('Invalid local request');
		return Promise.resolve(2);
	}, value => { applied.push(value); }, error => { errors.push(error); });
	await expect.poll(() => errors.length).toBe(1);
	await binding.refresh();
	expect(applied).toEqual([2]);
});
