import { afterEach, expect, it, vi } from 'vitest';
import { createMailFromEnv, Mail, ResendTransport } from '@db3.ai/app/mail';
import { runMailPreview } from '../../examples/runMailPreview';
import { welcomeMessage } from '../../examples/welcomeMessage';

afterEach(() => { vi.unstubAllGlobals(); });

it('rejects invalid recipients before writing, then creates one escaped local preview', async () => {
	expect(await runMailPreview()).toEqual({ transport: 'file', accepted: ['ada@example.test'], rejectedEmptyRecipients: true, files: 1, from: 'Notes <hello@example.test>', subject: 'Welcome to your notes', text: 'Hello Ada & team, your notebook is ready.', html: '<p>Hello Ada &amp; team, your notebook is ready.</p>' });
	expect(welcomeMessage('ada@example.test', '<b>Ada</b>').html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
	expect(() => welcomeMessage('invalid', 'Ada')).toThrow('recipient');
	expect(() => welcomeMessage('ada@example.test', 'Ada\nBcc: someone')).toThrow('line breaks');
});

it('reports missing provider configuration without sending, and validates content before HTTP', async () => {
	expect(() => createMailFromEnv({ MAIL_TRANSPORT: 'resend' })).toThrow('RESEND_API_KEY');
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	const mail = new Mail({ transport: new ResendTransport({ apiKey: 'test-only' }) });
	await expect(mail.send({ to: 'ada@example.test', subject: 'Empty' })).rejects.toThrow('text or html');
	expect(fetch).not.toHaveBeenCalled();
});

it('surfaces a provider rejection and allows an explicit successful retry with no automatic retry', async () => {
	const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Temporarily unavailable' }), { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'preview-message' }), { status: 200 }));
	vi.stubGlobal('fetch', fetch);
	const mail = new Mail({ from: 'Notes <hello@example.test>', transport: new ResendTransport({ apiKey: 'test-only', baseUrl: 'https://mail-provider.example.test' }) });
	const message = welcomeMessage('ada@example.test', 'Ada');
	await expect(mail.send(message)).rejects.toThrow('Temporarily unavailable');
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(await mail.send(message)).toMatchObject({ transport: 'resend', id: 'preview-message', accepted: ['ada@example.test'] });
	expect(fetch).toHaveBeenCalledTimes(2);
});
