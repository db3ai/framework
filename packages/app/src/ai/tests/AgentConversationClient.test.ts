import { createHelpConversationClient } from '../examples/createHelpConversationClient';
import { describe, expect, it, vi } from 'vitest';
import { createAgentConversation } from '../client';
import type { AgentConversationSnapshot, AgentCursor, AgentHttpAdapter, AgentRealtimeHandlers, AgentUpdatePage } from '../contracts/AgentConversationStream';

/** Creates a consistent empty HTTP baseline for a selected thread. */
function snapshot(id = 'thread', sequence = 0): AgentConversationSnapshot {
	return { cursor: { conversationId: id, view: 'admin', epoch: '1', sequence }, timeline: [], run: null, activity: null, older: null };
}

/** Creates a valid committed text batch; provider output is represented by stable item identity. */
function update(after: AgentCursor, sequence: number, text = ''): AgentUpdatePage {
	return { kind: 'updates', after, cursor: { ...after, sequence }, through: { ...after, sequence }, hasMore: false, events: text ? [{ sequence, aiRequestId: 'root', attempt: 1, itemId: 'message', event: { type: 'text.delta', delta: text } }] : [] };
}

/** Owns only transport boundaries; the actual controller and reducer remain under test. */
function harness(overrides: Partial<AgentHttpAdapter> = {}) {
	let handlers!: AgentRealtimeHandlers;
	const detach = vi.fn();
	const http = { load: vi.fn(async (id: string) => snapshot(id)), updates: vi.fn(async (after: AgentCursor) => update(after, after.sequence)), ...overrides };
	const subscribe = vi.fn((_id: string, value: AgentRealtimeHandlers) => { handlers = value; return detach; });
	const client = createAgentConversation({ view: 'admin', http, realtime: { subscribe } });
	return { client, http, subscribe, detach, live: () => handlers };
}

/** Allows a test to control a specific asynchronous transport race. */
function pending<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

describe('HTTP-first conversation client', () => {
	it('stops the captured turn through HTTP without detaching and ignores an acknowledgement after switching conversations', async () => {
		const completion = pending<{ conversationId: string; aiRequestId: string; status: 'cancelled' }>();
		const stop = vi.fn(() => completion.promise);
		const h = harness({ stop, load: async id => ({ ...snapshot(id), run: { aiRequestId: `${id}-run`, status: 'running', attempt: 1, startedAt: null, completedAt: null, error: null } }) });
		try {
			await h.client.open('first');
			const stopping = h.client.stop();
			expect(stop).toHaveBeenCalledWith({ conversationId: 'first', aiRequestId: 'first-run' }, expect.any(AbortSignal));
			expect(h.detach).not.toHaveBeenCalled();
			await h.client.open('second');
			completion.resolve({ conversationId: 'first', aiRequestId: 'first-run', status: 'cancelled' }); await stopping;
			expect(h.client.getState().snapshot?.run?.aiRequestId).toBe('second-run');
			expect(h.http.updates).not.toHaveBeenCalled();
		} finally { h.client.dispose(); }
	});

	it('loads before subscribing and reconciles overlapping live output exactly once', async () => {
		const recovery = pending<AgentUpdatePage>();
		const h = harness({ updates: vi.fn(() => recovery.promise) });
		const notices = vi.fn();
		const detach = h.client.stream('thread', notices);
		await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
		expect(notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot' }));
		h.live().connection('connected'); h.live().subscribed();
		const first = update(snapshot().cursor, 1, 'Hello ');
		h.live().update(first);
		h.live().update(update(first.cursor, 2, 'world'));
		recovery.resolve(first);
		await vi.waitFor(() => expect(h.client.getState().snapshot?.cursor.sequence).toBe(2));
		h.live().update(first);
		expect(h.client.getState().snapshot?.timeline).toMatchObject([{ id: 'message', content: 'Hello world' }]);
		expect(notices.mock.calls.filter(([notice]) => notice.type === 'event')).toHaveLength(2);
		detach(); expect(h.detach).toHaveBeenCalledOnce(); h.client.dispose();
	});

	it('recovers a missed final event after reconnect without polling', async () => {
		const reads = vi.fn(async (after: AgentCursor) => update(after, after.sequence === 0 ? 1 : 2, after.sequence === 0 ? 'A' : 'B'));
		const h = harness({ updates: reads });
		await h.client.open('thread');
		h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().snapshot?.cursor.sequence).toBe(1));
		expect(reads).toHaveBeenCalledTimes(1);
		h.live().connection('disconnected'); h.live().connection('connected'); h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().snapshot?.cursor.sequence).toBe(2));
		expect(h.client.getState().snapshot?.timeline).toMatchObject([{ content: 'AB' }]);
		vi.useFakeTimers();
		try { await vi.advanceTimersByTimeAsync(60_000); expect(reads).toHaveBeenCalledTimes(2); }
		finally { vi.useRealTimers(); h.client.dispose(); }
	});

	it('keeps one fixed watermark while paging and advances over private filtered sequences', async () => {
		const through = { ...snapshot().cursor, sequence: 9 };
		const reads = vi.fn(async (after: AgentCursor, watermark?: AgentCursor) => {
			if (!watermark) return { ...update(after, 3), through, hasMore: true };
			expect(watermark).toEqual(through);
			return update(after, 9, 'Visible');
		});
		const h = harness({ updates: reads }); await h.client.open('thread'); h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().snapshot?.cursor.sequence).toBe(9));
		expect(reads).toHaveBeenCalledTimes(2); h.client.dispose();
	});

	it('reloads an expired cursor, then resumes from the new projection epoch', async () => {
		const baseline = snapshot('thread', 20); baseline.cursor.epoch = '2';
		const h = harness({ load: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(baseline), updates: vi.fn().mockResolvedValueOnce({ kind: 'snapshot_required', conversationId: 'thread', view: 'admin', reason: 'projection_changed' }).mockImplementation(async after => update(after, after.sequence)) });
		await h.client.open('thread'); h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().snapshot?.cursor.epoch).toBe('2'));
		expect(h.client.getState().error).toBeNull(); h.client.dispose();
	});

	it('fences selection races and immediately detaches an attachment while HTTP is pending', async () => {
		const slow = pending<AgentConversationSnapshot>();
		const h = harness({ load: vi.fn(id => id === 'old' ? slow.promise : Promise.resolve(snapshot(id))) });
		const detach = h.client.stream('old', vi.fn()); detach();
		slow.resolve(snapshot('old'));
		await h.client.open('new');
		expect(h.subscribe).toHaveBeenCalledTimes(1);
		expect(h.client.getState().snapshot?.cursor.conversationId).toBe('new');
		h.client.dispose(); expect(h.detach).toHaveBeenCalledOnce();
	});

	it('clears restricted content on socket denial and HTTP authorization loss', async () => {
		const h = harness({ updates: vi.fn().mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 })) });
		await h.client.open('thread'); h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().connection).toBe('denied'));
		expect(h.client.getState().snapshot).toBeNull(); expect(h.detach).toHaveBeenCalledOnce();
		await h.client.open('thread'); h.live().denied();
		expect(h.client.getState().snapshot).toBeNull(); h.client.dispose();
	});

	it('reuses the same submission key after an uncertain response and keeps admission separate from viewing', async () => {
		const run = { jobId: 'job', conversationId: 'thread', aiRequestId: 'root', traceId: 'trace' };
		const send = vi.fn().mockRejectedValueOnce(new Error('Reply lost')).mockResolvedValueOnce(run);
		const h = harness({ send, load: vi.fn().mockRejectedValue(new Error('View unavailable')) });
		await expect(h.client.send('Hello')).rejects.toThrow('Reply lost');
		await expect(h.client.retrySend()).resolves.toEqual(run);
		expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
		expect(send.mock.calls[0][0].idempotencyKey).toMatch(/^[a-f\d-]{36}$/);
		h.client.dispose();
	});

	it('does not replace an updated large item with chunks from an older revision', async () => {
		const reference = { kind: 'reference' as const, id: 'message', itemKind: 'message' as const, key: 'message:record' };
		const page = pending<{ itemId: string; revision: string; content: string; nextOffset: null }>();
		const initial = snapshot(); initial.timeline = [reference];
		const h = harness({ load: vi.fn(async () => initial), item: vi.fn(() => page.promise) });
		await h.client.open('thread'); h.live().subscribed();
		await vi.waitFor(() => expect(h.client.getState().synchronizing).toBe(false));
		const read = h.client.loadItem(reference);
		h.live().update({ ...update(initial.cursor, 1), events: [{ sequence: 1, aiRequestId: 'root', attempt: 1, itemId: 'message', event: { type: 'item.changed', item: reference } }] });
		page.resolve({ itemId: reference.key, revision: 'old', content: JSON.stringify({ kind: 'message', id: 'message', role: 'assistant', content: 'Old', citations: [], createdAt: new Date().toISOString() }), nextOffset: null });
		await read;
		expect(h.client.getState().snapshot?.timeline).toEqual([reference]);
		expect(h.client.getState().error).toContain('changed while loading'); h.client.dispose();
	});
});


describe('documented HTTP conversation adapter', () => {
	it('submits through HTTP, restores a baseline and reuses the supplied realtime owner', async () => {
		const requests: Array<{ path: string; init?: RequestInit }> = [];
		let handlers!: AgentRealtimeHandlers;
		const remove = vi.fn();
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			requests.push({ path: url, init });
			if (url.endsWith('/send')) return Response.json({ jobId: 1, conversationId: 'help', aiRequestId: 'root', traceId: 'trace' }, { status: 202 });
			const saved = snapshot('help'); saved.cursor.view = 'conversation';
			return Response.json(url.includes('/updates?') ? update(saved.cursor, 0) : saved);
		});
		const client = createHelpConversationClient({ baseUrl: '/api/help/conversations', headers: () => ({ authorization: 'Bearer synthetic-session' }), realtime: { subscribe(_id, value) { handlers = value; return remove; } } });
		try {
			await client.send('How do I start?');
			await vi.waitFor(() => expect(client.getState().snapshot?.cursor.conversationId).toBe('help'));
			handlers.subscribed();
			await vi.waitFor(() => expect(requests).toHaveLength(3));
			expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({ message: 'How do I start?', conversationId: null, idempotencyKey: expect.any(String) });
			expect(new Headers(requests[1]!.init?.headers).get('authorization')).toBe('Bearer synthetic-session');
			expect(requests[1]!.path).toBe('/api/help/conversations/help/snapshot');
		} finally { client.dispose(); vi.unstubAllGlobals(); }
		expect(remove).toHaveBeenCalledOnce();
	});
});
