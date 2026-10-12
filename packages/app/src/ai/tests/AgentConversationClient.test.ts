import { describe, expect, it, vi } from 'vitest';
import { createAgentConversation, createAgentConversationHttp } from '../client';
import { createHelpConversationClient } from '../examples/createHelpConversationClient';
import type * as stream from '../contracts/AgentConversationStream';
import type { QueuedAgentRunResponse } from '../contracts/AgentProtocol';

/** Creates a current running turn with deterministic saved state. */
function snapshot(id = 'thread', timeline: stream.AgentTimelineEntry[] = []): stream.AgentConversationSnapshot {
	return { conversationId: id, view: 'admin', timeline, run: { aiRequestId: `${id}-run`, status: 'running', attempt: 1, startedAt: null, completedAt: null, error: null }, activity: { code: 'thinking', label: 'Thinking...' }, older: null, queued: 0 };
}

/** Creates a complete saved assistant message with an identity shared with transient output. */
function message(id: string, content: string): stream.AgentTimelineEntry {
	return { kind: 'message', id, role: 'assistant', content, citations: [], createdAt: '2026-10-12T00:00:00.000Z', streaming: false };
}

/** Creates a live envelope without replay sequences or persistent cursors. */
function update(event: stream.AgentConversationEvent, itemId: string | null = 'message', id = 'thread'): stream.AgentLiveUpdate {
	return { conversationId: id, view: 'admin', aiRequestId: `${id}-run`, attempt: 1, itemId, event };
}

/** Uses actual client logic and replaces only application-owned transport boundaries. */
function harness(overrides: Partial<stream.AgentHttpAdapter> = {}) {
	let handlers!: stream.AgentRealtimeHandlers;
	const detach = vi.fn();
	const http = { load: vi.fn(async (id: string) => snapshot(id)), ...overrides };
	const subscribe = vi.fn((_id: string, value: stream.AgentRealtimeHandlers) => { handlers = value; return detach; });
	const client = createAgentConversation({ view: 'admin', http, realtime: { subscribe } });
	return { client, http, subscribe, detach, live: () => handlers };
}

/** Controls one transport response to reproduce attachment and selection races. */
function pending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

/** Waits for a subscribed history refresh without timers or a provider call. */
async function connect(h: ReturnType<typeof harness>): Promise<void> {
	h.live().connection('connected'); h.live().subscribed();
	await vi.waitFor(() => expect(h.client.getState().synchronizing).toBe(false));
}

/** Represents admission only; provider execution is independent of the HTTP request. */
function admission(id = 'thread'): QueuedAgentRunResponse { return { conversationId: id, aiRequestId: `${id}-queued`, traceId: 'trace', jobId: 'job' }; }

describe('best-effort conversation client', () => {
	it('loads first, backfills the connection gap and replaces partial output with saved items', async () => {
		const read = pending<stream.AgentConversationSnapshot>();
		const h = harness({ load: vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => read.promise).mockResolvedValue(snapshot('thread', [message('6', 'Saved in the gap')])) });
		try {
			const notices = vi.fn(); h.client.stream('thread', notices);
			await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledOnce());
			expect(notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot' }));
			h.live().subscribed();
			h.live().update(update({ type: 'text.delta', delta: 'overlapping' }, '6'));
			read.resolve(snapshot('thread', [message('6', 'Saved in the gap')]));
			await vi.waitFor(() => expect(h.client.getState().synchronizing).toBe(false));
			h.live().update(update({ type: 'text.delta', delta: 'Partial ' }, '7'));
			h.live().update(update({ type: 'item.changed', item: message('7', 'Complete reply') }, '7'));
			h.live().update(update({ type: 'text.delta', delta: 'late duplicate' }, '7'));
			expect(h.client.getState().snapshot?.timeline).toMatchObject([{ id: '6', content: 'Saved in the gap' }, { id: '7', content: 'Complete reply', streaming: false }]);
		} finally { h.client.dispose(); }
	});

	it('reads again when a save notification arrives during the subscription refresh', async () => {
		const gap = pending<stream.AgentConversationSnapshot>();
		const load = vi.fn().mockResolvedValueOnce(snapshot()).mockImplementationOnce(() => gap.promise).mockResolvedValue(snapshot('thread', [message('6', 'Completed')]));
		const h = harness({ load });
		try {
			await h.client.open('thread'); h.live().subscribed();
			h.live().update(update({ type: 'item.changed', item: message('6', 'Completed') }, '6'));
			gap.resolve(snapshot());
			await vi.waitFor(() => expect(h.client.getState().snapshot?.timeline).toMatchObject([{ id: '6', content: 'Completed' }]));
			expect(load).toHaveBeenCalledTimes(3);
		} finally { h.client.dispose(); }
	});

	it('restores final state after reconnect without polling or inferring failure from disconnect', async () => {
		const completed = snapshot('thread', [message('final', 'Done')]); completed.run!.status = 'completed'; completed.activity = null;
		const load = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot()).mockResolvedValue(completed);
		const h = harness({ load });
		try {
			await h.client.open('thread'); await connect(h);
			h.live().connection('disconnected');
			expect(h.client.getState().snapshot?.run?.status).toBe('running');
			await connect(h);
			expect(h.client.getState().snapshot?.run?.status).toBe('completed');
			expect(h.client.getState().snapshot?.timeline).toMatchObject([{ content: 'Done' }]);
			vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(60_000); expect(load).toHaveBeenCalledTimes(3);
		} finally { vi.useRealTimers(); h.client.dispose(); }
	});

	it('refreshes old pages so tools outside the newest page can finish after reconnect', async () => {
		const tool: stream.AgentTimelineEntry = { kind: 'tool', id: 'tool', toolName: 'research', arguments: {}, state: 'calling', definition: null, progressUpdates: [], result: null, error: null };
		const current = { ...snapshot('thread', [message('recent', 'Recent')]), older: 50 };
		const older = { ...snapshot('thread', [message('old', 'Old'), tool]), older: 10 };
		const history = vi.fn().mockResolvedValueOnce(older).mockResolvedValue({ ...older, timeline: [message('old', 'Old'), { ...tool, state: 'success', result: { found: 4 } }] });
		const h = harness({ load: vi.fn(async () => structuredClone(current)), history });
		try {
			await h.client.open('thread'); await h.client.loadOlder(); await connect(h);
			expect(h.client.getState().snapshot?.timeline).toMatchObject([{ id: 'old' }, { id: 'tool', state: 'success', result: { found: 4 } }, { id: 'recent' }]);
			expect(h.client.getState().snapshot?.older).toBe(10);
			expect(history).toHaveBeenCalledTimes(2);
			expect(history).toHaveBeenLastCalledWith('thread', 50, expect.any(AbortSignal));
		} finally { h.client.dispose(); }
	});

	it.each([50, null])('walks contiguous history after a large reconnect gap through boundary %s', async boundary => {
		/** Creates one ordered database page; the cursor describes the whole saved-message range. */
		const page = (ids: number[], older: number | null) => ({ ...snapshot('thread', ids.map(id => message(String(id), `Saved ${id}`))), older });
		const load = vi.fn().mockResolvedValueOnce(page([70, 80], 70)).mockResolvedValue(page([150, 160], 150));
		const history = vi.fn(async (_id: string, before: number) => {
			if (before === 150) return page([110, 120, 130, 140], 110);
			if (before === 110) return page([70, 80, 90, 100], 70);
			if (before === 70) return page([50, 60], boundary);
			throw new Error(`Unexpected history boundary ${before}`);
		});
		const h = harness({ load, history });
		try {
			await h.client.open('thread'); await h.client.loadOlder(); await connect(h);
			expect(h.client.getState().snapshot?.timeline.map(item => item.id)).toEqual(['50', '60', '70', '80', '90', '100', '110', '120', '130', '140', '150', '160']);
			expect(h.client.getState().snapshot?.older).toBe(boundary);
			expect(history.mock.calls.map(([, before]) => before)).toEqual([70, 150, 110, 70]);
		} finally { h.client.dispose(); }
	});

	it('retries an older read against the new boundary when refresh overtakes it', async () => {
		const stale = pending<stream.AgentConversationSnapshot>();
		const load = vi.fn().mockResolvedValueOnce({ ...snapshot('thread', [message('90', 'Original latest')]), older: 90 }).mockResolvedValue({ ...snapshot('thread', [message('190', 'Latest after refresh')]), older: 190 });
		const history = vi.fn().mockImplementationOnce(() => stale.promise).mockResolvedValue({ ...snapshot('thread', [message('150', 'Contiguous older')]), older: 150 });
		const h = harness({ load, history });
		try {
			await h.client.open('thread');
			const older = h.client.loadOlder(); const samePage = h.client.loadOlder();
			await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1));
			await h.client.refresh();
			stale.resolve({ ...snapshot('thread', [message('50', 'Stale detached range')]), older: 50 });
			await older; await samePage;
			expect(h.client.getState().snapshot?.timeline.map(item => item.id)).toEqual(['150', '190']);
			expect(h.client.getState().snapshot?.older).toBe(150);
			expect(history.mock.calls.map(([, before]) => before)).toEqual([90, 190]);
		} finally { h.client.dispose(); }
	});

	it('rejects repeated history boundaries without looping or replacing saved state', async () => {
		const history = vi.fn(async () => ({ ...snapshot(), older: 50 }));
		const h = harness({ load: async () => ({ ...snapshot('thread', [message('latest', 'Saved')]), older: 50 }), history });
		try {
			await h.client.open('thread'); await h.client.loadOlder();
			expect(history).toHaveBeenCalledOnce();
			expect(h.client.getState()).toMatchObject({ error: 'Invalid conversation history boundary.', snapshot: { older: 50, timeline: [{ id: 'latest' }] } });
		} finally { h.client.dispose(); }
	});

	it('stops a restored running conversation by ID and fences the late acknowledgement', async () => {
		const completion = pending<stream.AgentStopResult>();
		const stop = vi.fn(() => completion.promise);
		const h = harness({ stop });
		try {
			await h.client.open('first'); const stopping = h.client.stop();
			expect(stop).toHaveBeenCalledWith({ conversationId: 'first' }, expect.any(AbortSignal));
			expect(h.detach).not.toHaveBeenCalled();
			await h.client.open('second');
			completion.resolve({ conversationId: 'first', aiRequestId: 'first-run', status: 'cancelled' }); await stopping;
			expect(h.client.getState().snapshot?.run?.aiRequestId).toBe('second-run');
			expect(h.http.load).toHaveBeenCalledTimes(2);
		} finally { h.client.dispose(); }
	});

	it('admits queued input during a running turn and waits for coherent saved state', async () => {
		const load = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue({ ...snapshot(), queued: 1 });
		const send = vi.fn(async () => admission());
		const h = harness({ load, send });
		try {
			await h.client.open('thread'); await h.client.send('Next instruction');
			expect(h.client.getState()).toMatchObject({ sending: false, snapshot: { queued: 1, run: { status: 'running' } } });
			expect(send).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'thread', message: 'Next instruction', idempotencyKey: expect.any(String) }), expect.any(AbortSignal));
		} finally { h.client.dispose(); }
	});

	it('retains the exact submission after uncertain failure and never duplicates it on retry', async () => {
		const send = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(admission());
		const h = harness({ send });
		try {
			await h.client.open('thread'); await expect(h.client.send('Continue')).rejects.toThrow('Connection lost');
			expect(h.client.getState()).toMatchObject({ canSend: false, canRetrySend: true });
			await expect(h.client.send('Different')).rejects.toThrow('Retry the previous submission');
			await h.client.retrySend();
			expect(h.client.getState()).toMatchObject({ canSend: true, canRetrySend: false });
			expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
			expect(h.client.getState().error).toBeNull();
		} finally { h.client.dispose(); }
	});

	it('permits a fresh input after a definite rejection and retains admission after a history failure', async () => {
		const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Insufficient credits'), { status: 402 })).mockResolvedValue(admission());
		const h = harness({ send, load: vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error('History unavailable')) });
		try {
			await h.client.open('thread'); await expect(h.client.send('First')).rejects.toThrow('Insufficient credits');
			expect(h.client.getState()).toMatchObject({ canSend: true, canRetrySend: false });
			await expect(h.client.send('Revised')).resolves.toEqual(admission());
			expect(send.mock.calls[1]![0].idempotencyKey).not.toEqual(send.mock.calls[0]![0].idempotencyKey);
			expect(h.client.getState()).toMatchObject({ error: 'History unavailable', canRetrySend: false });
		} finally { h.client.dispose(); }
	});

	it('returns accepted new-conversation IDs even if the first history load fails', async () => {
		const h = harness({ send: async () => admission('new'), load: async () => { throw new Error('History unavailable'); } });
		try { await expect(h.client.send('Hello')).resolves.toEqual(admission('new')); expect(h.client.getState()).toMatchObject({ error: 'History unavailable', sending: false, canRetrySend: false }); }
		finally { h.client.dispose(); }
	});

	it('does not reopen the previous conversation when a send completes after selection changed', async () => {
		const sent = pending<QueuedAgentRunResponse>();
		const send = vi.fn().mockImplementationOnce(() => sent.promise).mockResolvedValue(admission('second'));
		const h = harness({ send });
		try {
			await h.client.open('first'); const sending = h.client.send('Old instruction');
			await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
			await h.client.open('second'); await h.client.send('New instruction');
			sent.resolve(admission('first')); await sending;
			expect(h.client.getState().snapshot?.conversationId).toBe('second');
			expect(send.mock.calls[1]![0]).toMatchObject({ conversationId: 'second', message: 'New instruction' });
		} finally { h.client.dispose(); }
	});

	it('does not send a pending old selection into a newly selected conversation', async () => {
		const loading = pending<stream.AgentConversationSnapshot>();
		const send = vi.fn(async () => admission('second'));
		const h = harness({ load: vi.fn(id => id === 'first' ? loading.promise : Promise.resolve(snapshot(id))), send });
		try {
			const opening = h.client.open('first');
			const sending = h.client.send('Old instruction'); const rejected = expect(sending).rejects.toThrow('selection changed');
			await h.client.open('second'); loading.resolve(snapshot('first')); await opening; await rejected;
			expect(send).not.toHaveBeenCalled();
		} finally { h.client.dispose(); }
	});

	it('opens the admitted conversation before resolving a new send', async () => {
		const h = harness({ send: async () => admission('new') });
		try { await h.client.send('Hello'); expect(h.client.getState()).toMatchObject({ sending: false, snapshot: { conversationId: 'new' } }); expect(h.subscribe).toHaveBeenCalledOnce(); }
		finally { h.client.dispose(); }
	});

	it('clears private data on denied reads and ignores late events from detached selections', async () => {
		const load = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
		const h = harness({ load });
		try {
			await h.client.open('thread'); const live = h.live(); await connect(h);
			expect(h.client.getState()).toMatchObject({ connection: 'denied', snapshot: null });
			live.update(update({ type: 'text.delta', delta: 'private' }));
			expect(h.client.getState().snapshot).toBeNull(); expect(h.detach).toHaveBeenCalledOnce();
		} finally { h.client.dispose(); }
	});

	it('rejects malformed and wrong-conversation frames without mutating the timeline', async () => {
		const h = harness();
		try {
			await h.client.open('thread'); await connect(h);
			h.live().update(update({ type: 'text.delta', delta: 'wrong' }, 'message', 'other'));
			expect(h.client.getState().error).toMatch('another conversation');
			h.live().update(update({ type: 'text.delta', delta: 'a'.repeat(300_000) }));
			expect(h.client.getState().snapshot?.timeline).toEqual([]);
			expect(h.client.getState().error).toMatch('too large');
		} finally { h.client.dispose(); }
	});

	it('keeps provider reasoning summaries visible and saves their canonical completion', async () => {
		const h = harness();
		try {
			await h.client.open('thread'); await connect(h);
			h.live().update(update({ type: 'reasoning.summary.delta', id: 'reasoning', delta: 'Comparing sources' }, 'reasoning'));
			h.live().update(update({ type: 'item.changed', item: { kind: 'reasoning_summary', id: 'reasoning', text: 'Compared the supplied sources.', createdAt: '2026-10-12T00:00:00Z', streaming: false } }, 'reasoning'));
			expect(h.client.getState().snapshot?.timeline).toMatchObject([{ kind: 'reasoning_summary', text: 'Compared the supplied sources.', streaming: false }]);
		} finally { h.client.dispose(); }
	});

	it('detaches observers during pending loads and disposal aborts reads without stopping execution', async () => {
		const read = pending<stream.AgentConversationSnapshot>();
		const stop = vi.fn(); let signal: AbortSignal | undefined;
		const h = harness({ load: vi.fn((_id, requestSignal) => { signal = requestSignal; return read.promise; }), stop });
		const detach = h.client.stream('thread', vi.fn()); detach();
		expect(signal?.aborted).toBe(true); read.resolve(snapshot());
		await Promise.resolve(); await Promise.resolve();
		expect(h.subscribe).not.toHaveBeenCalled(); h.client.dispose(); expect(stop).not.toHaveBeenCalled();
	});

	it('keeps new attachments alive when an old selection reuses the same callback', async () => {
		const h = harness(); const listener = vi.fn();
		try {
			const detachFirst = h.client.stream('first', listener);
			await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(1));
			const detachSecond = h.client.stream('second', listener);
			await vi.waitFor(() => expect(h.subscribe).toHaveBeenCalledTimes(2));
			detachFirst(); expect(h.detach).toHaveBeenCalledTimes(1);
			detachSecond(); expect(h.detach).toHaveBeenCalledTimes(2);
		} finally { h.client.dispose(); }
	});
});

describe('standard conversation HTTP adapter', () => {
	it('uses ordinary saved-history routes and sends a body-free POST to stop', async () => {
		const fetcher = vi.fn(async () => Response.json(snapshot()));
		const adapter = createAgentConversationHttp({ baseUrl: '/api/conversations/', view: 'conversation', fetch: fetcher, headers: () => ({ 'x-scope': 'organization' }) });
		const signal = new AbortController().signal;
		await adapter.load('thread/one', signal); await adapter.history!('thread/one', 42, signal); await adapter.stop!({ conversationId: 'thread/one' }, signal);
		expect(fetcher.mock.calls).toEqual([
			['/api/conversations/thread%2Fone/snapshot?view=conversation', { method: 'GET', headers: { 'x-scope': 'organization' }, signal }],
			['/api/conversations/thread%2Fone/history?view=conversation&before=42', { method: 'GET', headers: { 'x-scope': 'organization' }, signal }],
			['/api/conversations/thread%2Fone/stop', { method: 'POST', headers: { 'x-scope': 'organization' }, signal }],
		]);
	});

	it('keeps denied HTTP status available for client authorization cleanup', async () => {
		const adapter = createAgentConversationHttp({ baseUrl: '/api/conversations', view: 'admin', fetch: async () => new Response(null, { status: 403 }) });
		await expect(adapter.load('thread', new AbortController().signal)).rejects.toMatchObject({ status: 403 });
	});

	it('runs the public help example with the shared routes and an application-owned send endpoint', async () => {
		const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/send') ? admission() : url.endsWith('/stop') ? { conversationId: 'thread', aiRequestId: 'thread-run', status: 'cancelled' } : { ...snapshot(), view: 'conversation' }));
		vi.stubGlobal('fetch', fetcher);
		const client = createHelpConversationClient({ baseUrl: '/api/help/conversations', headers: () => ({ authorization: 'test-session' }), realtime: { subscribe: () => () => undefined } });
		try { await client.send('Hello'); await client.stop(); expect(fetcher).toHaveBeenCalledWith('/api/help/conversations/thread/stop', expect.objectContaining({ method: 'POST' })); }
		finally { client.dispose(); vi.unstubAllGlobals(); }
	});
});
