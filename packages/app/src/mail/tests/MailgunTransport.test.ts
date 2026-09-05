import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	createMailTransportFromEnv,
	MailgunTransport,
	MailTransportError,
} from '@db3.ai/app/mail';

describe('MailgunTransport', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('formats and submits a Mailgun API request', async () => {
		const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			return new Response(JSON.stringify({
				id: '<mailgun-message-id@example.com>',
				message: 'Queued. Thank you.',
			}), {
				status: 200,
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const transport = new MailgunTransport({
			apiKey: 'mailgun-key',
			domain: 'mg.example.com',
			baseUrl: 'https://mailgun.test/v3',
		});
		const delivery = await transport.send({
			from: {
				email: 'hello@example.com',
				name: 'Scout Team',
			},
			to: [
				'steve@example.com',
				{
					email: 'ada@example.com',
					name: 'Ada',
				},
			],
			subject: 'Welcome',
			text: 'Hello from Scout.',
			html: '<p>Hello from Scout.</p>',
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = init.body as URLSearchParams;

		expect(url).toBe('https://mailgun.test/v3/mg.example.com/messages');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			authorization: `Basic ${Buffer.from('api:mailgun-key').toString('base64')}`,
		});
		expect(body).toBeInstanceOf(URLSearchParams);
		expect(body.get('from')).toBe('"Scout Team" <hello@example.com>');
		expect(body.getAll('to')).toEqual([
			'steve@example.com',
			'"Ada" <ada@example.com>',
		]);
		expect(body.get('subject')).toBe('Welcome');
		expect(body.get('text')).toBe('Hello from Scout.');
		expect(body.get('html')).toBe('<p>Hello from Scout.</p>');
		expect(delivery).toEqual({
			id: '<mailgun-message-id@example.com>',
			transport: 'mailgun',
			accepted: [
				'steve@example.com',
				'ada@example.com',
			],
			rejected: [],
		});
	});

	it('reports the provider rejection message', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			return new Response(JSON.stringify({
				message: 'Domain is not authorized.',
			}), {
				status: 403,
				statusText: 'Forbidden',
			});
		}));

		const transport = new MailgunTransport({
			apiKey: 'mailgun-key',
			domain: 'mg.example.com',
		});
		const delivery = transport.send({
			from: 'Scout <hello@example.com>',
			to: ['steve@example.com'],
			subject: 'Welcome',
			text: 'Hello from Scout.',
		});

		await expect(delivery).rejects.toBeInstanceOf(MailTransportError);
		await expect(delivery).rejects.toThrow(
			'Mailgun rejected the message: Domain is not authorized.',
		);
	});

	it('falls back to the HTTP status when a rejection has no JSON message', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			return new Response('not-json', {
				status: 502,
				statusText: 'Bad Gateway',
			});
		}));

		const transport = new MailgunTransport({
			apiKey: 'mailgun-key',
			domain: 'mg.example.com',
		});

		await expect(transport.send({
			from: 'Scout <hello@example.com>',
			to: ['steve@example.com'],
			subject: 'Welcome',
			text: 'Hello from Scout.',
		})).rejects.toThrow('Mailgun rejected the message: Bad Gateway');
	});

	it('requires Mailgun credentials when selected from the environment', () => {
		expect(createMailTransportFromEnv({
			MAIL_TRANSPORT: 'mailgun',
			MAILGUN_API_KEY: 'mailgun-key',
			MAILGUN_DOMAIN: 'mg.example.com',
		})).toBeInstanceOf(MailgunTransport);

		expect(() => createMailTransportFromEnv({
			MAIL_TRANSPORT: 'mailgun',
			MAILGUN_DOMAIN: 'mg.example.com',
		})).toThrow(
			'MAILGUN_API_KEY and MAILGUN_DOMAIN are required for mailgun transport.',
		);
		expect(() => createMailTransportFromEnv({
			MAIL_TRANSPORT: 'mailgun',
			MAILGUN_API_KEY: 'mailgun-key',
		})).toThrow(
			'MAILGUN_API_KEY and MAILGUN_DOMAIN are required for mailgun transport.',
		);
	});
});
