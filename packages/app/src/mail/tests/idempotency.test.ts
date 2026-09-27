import { Mail, ResendTransport } from '@db3.ai/app/mail';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); });

it('uses the same API idempotency header on explicit retry without adding it to the email payload', async () => {
	const fetch = vi.fn().mockRejectedValueOnce(new Error('Lost acknowledgement')).mockResolvedValueOnce(Response.json({ id: 'accepted-once' }));
	vi.stubGlobal('fetch', fetch);
	const mail = new Mail({ transport: new ResendTransport({ apiKey: 'synthetic-test' }) });
	const message = { to: 'recipient@example.test', subject: 'Ready', text: 'Your workspace is ready.', idempotencyKey: 'setup/123' };
	await expect(mail.send(message)).rejects.toThrow('Lost acknowledgement');
	await expect(mail.send(message)).resolves.toMatchObject({ id: 'accepted-once' });
	expect(fetch.mock.calls[0][0]).toEqual(fetch.mock.calls[1][0]);
	expect(fetch.mock.calls[0][1]).toEqual({ ...fetch.mock.calls[1][1], signal: fetch.mock.calls[0][1].signal });
	expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
	expect(fetch.mock.calls[1][1].redirect).toBe('error');
	expect(fetch.mock.calls[1][1].headers['Idempotency-Key']).toBe('setup/123');
	expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('idempotencyKey');
});

it.each(['', 'contains spaces', 'line\nbreak', 'x'.repeat(257)])('rejects invalid retry identity before provider submission', async idempotencyKey => {
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	const mail = new Mail({ transport: new ResendTransport({ apiKey: 'synthetic-test' }) });
	await expect(mail.send({ to: 'recipient@example.test', subject: 'Ready', text: 'Ready', idempotencyKey })).rejects.toThrow('idempotencyKey');
	expect(fetch).not.toHaveBeenCalled();
});
