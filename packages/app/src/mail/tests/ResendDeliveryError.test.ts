import { afterEach, expect, it, vi } from 'vitest';
import { Mail, MailDeliveryError, ResendTransport } from '@db3.ai/app/mail';

afterEach(() => vi.unstubAllGlobals());

it.each(['180', new Date(Date.now() + 180000).toUTCString()])('retains typed refusal metadata and Retry-After without retrying', async retryAfter => {
	const fetcher = vi.fn(async () => Response.json({ name: 'daily_quota_exceeded', message: 'Quota exceeded' }, { status: 429, headers: { 'retry-after': retryAfter } }));
	vi.stubGlobal('fetch', fetcher);
	const mail = new Mail({ transport: new ResendTransport({ apiKey: 'test' }) });
	const error = await mail.send({ to: 'operator@example.test', subject: 'Failure', text: 'Failure' }).catch(error => error);
	expect(error).toBeInstanceOf(MailDeliveryError);
	expect(error).toMatchObject({ provider: 'resend', status: 429, code: 'daily_quota_exceeded' });
	expect(error.retryAt.getTime()).toBeGreaterThan(Date.now() + 170000);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['invalid', '-1', '99999999999999999999999999'])('ignores malformed retry timing without inferring quota from message text', async retryAfter => {
	vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'daily_quota_exceeded', name: '<unsafe>' }, { status: 429, headers: { 'retry-after': retryAfter } })));
	const mail = new Mail({ transport: new ResendTransport({ apiKey: 'test' }) });
	await expect(mail.send({ to: 'operator@example.test', subject: 'Failure', text: 'Failure' })).rejects.toMatchObject({ code: null, retryAt: null });
});
