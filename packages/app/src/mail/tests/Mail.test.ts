import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMailTransportFromEnv, Mail } from '../Mail';
import { FileMailTransport } from '../transports/FileMailTransport';
import { ResendTransport } from '../transports/ResendTransport';

describe('Mail', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('writes messages with the file transport', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'platform-mail-'));
		const mail = new Mail({
			from: 'Example App <hello@example.com>',
			transport: new FileMailTransport({
				directory,
			}),
		});

		const delivery = await mail.send({
			to: {
				email: 'steve@example.com',
				name: 'Steve',
			},
			subject: 'Reset your password',
			text: 'Use this link.',
		});
		const written = JSON.parse(await readFile(delivery.path!, 'utf8')) as {
			from: string;
			to: string[];
			subject: string;
			text: string;
		};

		expect(delivery.transport).toBe('file');
		expect(delivery.accepted).toEqual(['steve@example.com']);
		expect(written).toMatchObject({
			from: 'Example App <hello@example.com>',
			to: ['"Steve" <steve@example.com>'],
			subject: 'Reset your password',
			text: 'Use this link.',
		});
	});

	it('requires message content', async () => {
		const mail = new Mail();

		await expect(
			mail.send({
				to: 'steve@example.com',
				subject: 'No body',
			}),
		).rejects.toThrow('Mail requires text or html content.');
	});

	it('creates resend transport from env', () => {
		const transport = createMailTransportFromEnv({
			MAIL_TRANSPORT: 'resend',
			RESEND_API_KEY: 'resend-key',
		});

		expect(transport).toBeInstanceOf(ResendTransport);
		expect(() => createMailTransportFromEnv({
			MAIL_TRANSPORT: 'resend',
		})).toThrow('RESEND_API_KEY is required for resend transport.');
	});

	it('sends messages with the resend transport', async () => {
		const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			return new Response(JSON.stringify({
				id: 'resend-email-id',
			}), {
				status: 200,
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const transport = new ResendTransport({
			apiKey: 'resend-key',
			baseUrl: 'https://resend.test/',
		});
		const delivery = await transport.send({
			from: {
				email: 'hello@example.com',
				name: 'Example App Team',
			},
			to: [
				'steve@example.com',
				{
					email: 'ada@example.com',
					name: 'Ada',
				},
			],
			subject: 'Welcome',
			text: 'Hello from Example App.',
			html: '<p>Hello from Example App.</p>',
			headers: {
				'X-Example-Test': 'true',
			},
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

		expect(url).toBe('https://resend.test/emails');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			authorization: 'Bearer resend-key',
			'content-type': 'application/json',
		});
		expect(JSON.parse(init.body as string)).toEqual({
			from: '"Example App Team" <hello@example.com>',
			to: [
				'steve@example.com',
				'"Ada" <ada@example.com>',
			],
			subject: 'Welcome',
			text: 'Hello from Example App.',
			html: '<p>Hello from Example App.</p>',
			headers: {
				'X-Example-Test': 'true',
			},
		});
		expect(delivery).toEqual({
			id: 'resend-email-id',
			transport: 'resend',
			accepted: [
				'steve@example.com',
				'ada@example.com',
			],
			rejected: [],
		});
	});

	it('reports resend rejection messages', async () => {
		const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
			return new Response(JSON.stringify({
				message: 'Invalid from address.',
			}), {
				status: 422,
				statusText: 'Unprocessable Entity',
			});
		});
		vi.stubGlobal('fetch', fetchMock);

		const transport = new ResendTransport({
			apiKey: 'resend-key',
		});

		await expect(transport.send({
			from: 'Example App <hello@example.com>',
			to: ['steve@example.com'],
			subject: 'Welcome',
			text: 'Hello from Example App.',
		})).rejects.toThrow('Resend rejected the message: Invalid from address.');
	});
});
