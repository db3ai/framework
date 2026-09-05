import {
	formatMailAddress,
	mailAddressEmail,
	type MailDelivery,
	type MailTransport,
	type ResolvedMailMessage,
} from '../Mail.js';

export interface MailgunTransportOptions {
	apiKey: string;
	domain: string;
	baseUrl?: string;
}

export class MailTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MailTransportError';
	}
}

/**
 * Mailgun API transport.
 *
 * This keeps the app-level mail contract separate from the provider-specific
 * HTTP call, so production can swap providers without touching auth flows.
 */
export class MailgunTransport implements MailTransport {
	private readonly apiKey: string;
	private readonly domain: string;
	private readonly baseUrl: string;

	constructor(options: MailgunTransportOptions) {
		this.apiKey = options.apiKey;
		this.domain = options.domain;
		this.baseUrl = options.baseUrl || 'https://api.mailgun.net/v3';
	}

	async send(message: ResolvedMailMessage): Promise<MailDelivery> {
		const form = new URLSearchParams();

		form.set('from', formatMailAddress(message.from));

		for (const recipient of message.to) {
			form.append('to', formatMailAddress(recipient));
		}

		form.set('subject', message.subject);

		if (message.text) {
			form.set('text', message.text);
		}

		if (message.html) {
			form.set('html', message.html);
		}

		const response = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
			method: 'POST',
			headers: {
				authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
			},
			body: form,
		});
		const result = await response.json().catch(() => null) as {
			id?: unknown;
			message?: unknown;
		} | null;

		if (!response.ok) {
			const detail = typeof result?.message === 'string'
				? result.message
				: response.statusText;

			throw new MailTransportError(`Mailgun rejected the message: ${detail}`);
		}

		return {
			id: typeof result?.id === 'string' ? result.id : '',
			transport: 'mailgun',
			accepted: message.to.map(mailAddressEmail),
			rejected: [],
		};
	}
}
