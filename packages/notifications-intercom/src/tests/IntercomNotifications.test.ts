import { afterEach, expect, it, vi } from 'vitest';
import { IntercomNotifications } from '../IntercomNotifications.js';

/** Supplies only mocked external Intercom responses, never real provider delivery. */
function provider(responses: Response[]) {
	return vi.fn(async (_url: string, _options?: RequestInit) => responses.shift() ?? Response.json({ id: 'message-1' }));
}
/** Creates a configured client without changing application or queue state. */
function client() { return new IntercomNotifications({ accessToken: 'test-secret', adminId: 'sender' }); }
afterEach(() => vi.unstubAllGlobals());

it('sends a named event and customization to the canonical user without an admin ID', async () => {
	const fetcher = provider([Response.json({ data: [{ id: 'contact', role: 'user' }] }), new Response(null, { status: 202 })]);
	vi.stubGlobal('fetch', fetcher);
	await new IntercomNotifications({ accessToken: 'test-secret' }).send('app-user', 'onboarding_notification', { report_url: 'https://example.test/report', count: 3 });
	expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ query: { field: 'external_id', operator: '=', value: 'app-user' } });
	expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ event_name: 'onboarding_notification', user_id: 'app-user', created_at: expect.any(Number), metadata: { report_url: 'https://example.test/report', count: 3 } });
});

it('sends only an inapp message and escapes content and action links', async () => {
	const fetcher = provider([Response.json({ data: [{ id: 'contact', role: 'user' }] })]);
	vi.stubGlobal('fetch', fetcher);
	await expect(client().sendMessage('app-user', { title: '<Ready>', body: 'A & B', action: { label: 'Open report', href: 'https://example.test/report?a=1&b=2' } })).resolves.toEqual({ id: 'message-1' });
	const payload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
	expect(payload).toMatchObject({ message_type: 'inapp', from: { type: 'admin', id: 'sender' }, to: { type: 'user', id: 'contact' }, create_conversation_without_contact_reply: false });
	expect(payload.body).toContain('&lt;Ready&gt;');
	expect(payload.body).toContain('A &amp; B');
	expect(payload.body).toContain('href="https://example.test/report?a=1&amp;b=2"');
});

it('creates a missing contact and resolves a simultaneous Messenger creation', async () => {
	const fetcher = provider([Response.json({ data: [] }), new Response(null, { status: 409 }), Response.json({ data: [{ id: 'contact', role: 'user' }] }), new Response(null, { status: 202 })]);
	vi.stubGlobal('fetch', fetcher);
	await client().send('app-user', 'onboarding_notification');
	expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ role: 'user', external_id: 'app-user' });
});

it('rejects ambiguous identities without sending a message', async () => {
	const fetcher = provider([Response.json({ data: [{ id: 'one', role: 'user' }, { id: 'two', role: 'user' }] })]);
	vi.stubGlobal('fetch', fetcher);
	await expect(client().send('app-user', 'onboarding_notification')).rejects.toThrow('ambiguous');
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it('propagates provider refusal without retrying or exposing response text', async () => {
	const fetcher = provider([Response.json({ data: [{ id: 'contact', role: 'user' }] }), new Response('private provider detail', { status: 429 })]);
	vi.stubGlobal('fetch', fetcher);
	await expect(client().send('app-user', 'onboarding_notification')).rejects.toMatchObject({ status: 429, message: 'Intercom event submission failed (429).' });
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects missing configuration, invalid metadata and dangerous links before delivery', async () => {
	const fetcher = provider([]); vi.stubGlobal('fetch', fetcher);
	await expect(new IntercomNotifications({ accessToken: '' }).send('app-user', 'event')).rejects.toThrow('access token');
	await expect(client().send('app-user', 'event', { nested: {} } as never)).rejects.toThrow('fields');
	await expect(client().sendMessage('app-user', { title: 'Test', body: 'Test', action: { label: 'Click', href: 'javascript:alert(1)' } })).rejects.toThrow('HTTP(S)');
	expect(fetcher).not.toHaveBeenCalled();
});
