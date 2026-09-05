import {
	formatMailAddress,
	mailAddressEmail,
	type MailDelivery,
	type MailTransport,
	type ResolvedMailMessage,
} from '../Mail.js';

export interface ResendTransportOptions {
	apiKey: string;
	baseUrl?: string;
}

class ResendTransportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ResendTransportError';
	}
}

/**
 * Resend API transport.
 */
export class ResendTransport implements MailTransport {
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(options: ResendTransportOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl || 'https://api.resend.com').replace(/\/+$/, '');
	}

	async send(message: ResolvedMailMessage): Promise<MailDelivery> {
		const payload: Record<string, unknown> = {
			from: formatMailAddress(message.from),
			to: message.to.map(formatMailAddress),
			subject: message.subject,
		};

		if (message.text) {
			payload.text = message.text;
		}

		if (message.html) {
			payload.html = message.html;
		}

		if (message.headers) {
			payload.headers = message.headers;
		}

		const response = await fetch(`${this.baseUrl}/emails`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify(payload),
		});
		const result = await response.json().catch(() => null) as {
			id?: unknown;
			message?: unknown;
		} | null;

		if (!response.ok) {
			const detail = typeof result?.message === 'string'
				? result.message
				: response.statusText;

			throw new ResendTransportError(`Resend rejected the message: ${detail}`);
		}

		return {
			id: typeof result?.id === 'string' ? result.id : '',
			transport: 'resend',
			accepted: message.to.map(mailAddressEmail),
			rejected: [],
		};
	}
}