import { MailDeliveryError } from '../MailDeliveryError.js';
import { formatMailAddress, mailAddressEmail, type MailDelivery, type MailTransport, type ResolvedMailMessage } from '../Mail.js';

export interface ResendTransportOptions {
	apiKey: string;
	baseUrl?: string;
}

/**
 * Resend API transport.
 */
export class ResendTransport implements MailTransport {
	readonly #apiKey: string;
	readonly #baseUrl: string;

	/** Creates a bounded Resend transport; credentials remain private to this instance. */
	constructor(options: ResendTransportOptions) {
		this.#apiKey = options.apiKey;
		this.#baseUrl = (options.baseUrl || 'https://api.resend.com').replace(/\/+$/, '');
	}

	/** Sends one message, forwarding a stable retry identity as an API header rather than an email header. */
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

		const response = await fetch(`${this.#baseUrl}/emails`, {
			method: 'POST',
			signal: AbortSignal.timeout(15000),
			redirect: 'error',
			headers: {
				authorization: `Bearer ${this.#apiKey}`,
				'content-type': 'application/json',
				...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}),
			},
			body: JSON.stringify(payload),
		});
		const result = await response.json().catch(() => null) as {
			id?: unknown;
			message?: unknown;
			name?: unknown;
		} | null;

		if (!response.ok) {
			const detail = typeof result?.message === 'string'
				? result.message
				: response.statusText;

			const code = typeof result?.name === 'string' && /^[a-z_]{1,100}$/.test(result.name) ? result.name : null;
			throw new MailDeliveryError(`Resend rejected the message: ${detail}`, 'resend', response.status, code, retryTime(response.headers.get('retry-after')));
		}

		return {
			id: typeof result?.id === 'string' ? result.id : '',
			transport: 'resend',
			accepted: message.to.map(mailAddressEmail),
			rejected: [],
		};
	}
}

/** Parses standard Retry-After seconds or HTTP dates, ignoring malformed, overflowing and past values. */
function retryTime(value: string | null): Date | null {
	if (!value) return null;
	const milliseconds = /^\d+$/.test(value) ? Date.now() + Number(value) * 1000 : Date.parse(value);
	return Number.isFinite(milliseconds) && milliseconds > Date.now() && milliseconds <= 8640000000000000 ? new Date(milliseconds) : null;
}
