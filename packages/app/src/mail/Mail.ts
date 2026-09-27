import {
	FileMailTransport,
	type FileMailTransportOptions,
} from './transports/FileMailTransport.js';
import {
	MailgunTransport,
	type MailgunTransportOptions,
} from './transports/MailgunTransport.js';
import {
	ResendTransport,
	type ResendTransportOptions,
} from './transports/ResendTransport.js';

/** Recipient or sender as an address string or an email plus display name. */
export type MailAddress = string | {
	email: string;
	name?: string;
};

/** Application-owned message; templates and recipient authorization stay in the app. */
export interface MailMessage {
	to: MailAddress | MailAddress[];
	from?: MailAddress;
	subject: string;
	text?: string;
	html?: string;
	/** Extra message headers; File and Resend preserve them, Mailgun currently does not. */
	headers?: Record<string, string>;
	/** Stable request identity for provider retries. Resend deduplicates identical requests for 24 hours; other built-in transports ignore this value. */
	idempotencyKey?: string;
}

/** Transport input with a default sender resolved and recipients normalized to an array. */
export interface ResolvedMailMessage extends Omit<MailMessage, 'from' | 'to'> {
	from: MailAddress;
	to: MailAddress[];
}

/** Provider acceptance or a local file write, not proof of inbox delivery. */
export interface MailDelivery {
	id: string;
	transport: string;
	accepted: string[];
	rejected: string[];
	/** Local JSON preview path when using the file transport. */
	path?: string;
}

/** Provider boundary; sending rejects on transport failure and never retries automatically. */
export interface MailTransport {
	/** Submits one normalized message to the selected transport. */
	send(message: ResolvedMailMessage): Promise<MailDelivery>;
}

/** Sender defaults and the explicitly selected transport for one Mail instance. */
export interface MailOptions {
	from?: MailAddress;
	transport?: MailTransport;
}

/** Application fallback sender, overridden by MAIL_FROM when present. */
export interface MailEnvOptions {
	from?: MailAddress;
}

const defaultMailFrom = 'Platform <no-reply@platform.local>';

/** Normalizes messages and delegates immediate delivery to one transport. */
export class Mail {
	private readonly from: MailAddress;
	private readonly transport: MailTransport;

	/** Creates a mail service; absent transport selects local file previews. */
	constructor(options: MailOptions = {}) {
		this.from = options.from ?? defaultMailFrom;
		this.transport = options.transport ?? new FileMailTransport();
	}

	/** Validates message presence and sends once; apps own retries and recipient policy. */
	async send(message: MailMessage): Promise<MailDelivery> {
		const resolved = this.resolveMessage(message);

		return this.transport.send(resolved);
	}

	/** Resolves the sender and recipient list without changing application content. */
	private resolveMessage(message: MailMessage): ResolvedMailMessage {
		if (message.idempotencyKey !== undefined && !/^[\x21-\x7e]{1,256}$/.test(message.idempotencyKey)) {
			throw new Error('Mail idempotencyKey must contain 1 to 256 printable non-space ASCII characters.');
		}
		const to = Array.isArray(message.to) ? message.to : [message.to];

		if (to.length === 0) {
			throw new Error('Mail requires at least one recipient.');
		}

		if (!message.text && !message.html) {
			throw new Error('Mail requires text or html content.');
		}

		return {
			...message,
			from: message.from ?? this.from,
			to,
		};
	}
}

/** Builds a shared Mail instance from an explicit environment or process.env. */
export function createMailFromEnv(
	env: NodeJS.ProcessEnv = process.env,
	options: MailEnvOptions = {},
): Mail {
	return new Mail({
		from: env.MAIL_FROM || options.from || defaultMailFrom,
		transport: createMailTransportFromEnv(env),
	});
}

/** Selects the transport; missing or unrecognized names currently fall back to file. */
export function createMailTransportFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): MailTransport {
	const transport = (env.MAIL_TRANSPORT || env.MAIL_MAILER || 'file').toLowerCase();

	if (transport === 'mailgun') {
		return new MailgunTransport(mailgunOptionsFromEnv(env));
	}

	if (transport === 'resend') {
		return new ResendTransport(resendOptionsFromEnv(env));
	}

	return new FileMailTransport(fileOptionsFromEnv(env));
}

/** Reads the application-owned directory for plaintext development previews. */
function fileOptionsFromEnv(env: NodeJS.ProcessEnv): FileMailTransportOptions {
	return {
		directory: env.MAIL_FILE_DIRECTORY,
	};
}

/** Requires both Mailgun credentials before constructing the HTTP transport. */
function mailgunOptionsFromEnv(env: NodeJS.ProcessEnv): MailgunTransportOptions {
	if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
		throw new Error('MAILGUN_API_KEY and MAILGUN_DOMAIN are required for mailgun transport.');
	}

	return {
		apiKey: env.MAILGUN_API_KEY,
		domain: env.MAILGUN_DOMAIN,
		baseUrl: env.MAILGUN_BASE_URL,
	};
}

/** Requires Resend credentials before constructing the HTTP transport. */
function resendOptionsFromEnv(env: NodeJS.ProcessEnv): ResendTransportOptions {
	if (!env.RESEND_API_KEY) {
		throw new Error('RESEND_API_KEY is required for resend transport.');
	}

	return {
		apiKey: env.RESEND_API_KEY,
		baseUrl: env.RESEND_BASE_URL,
	};
}

/** Formats an address for transport use; this is not validation or header sanitization. */
export function formatMailAddress(address: MailAddress): string {
	if (typeof address === 'string') {
		return address;
	}

	if (!address.name) {
		return address.email;
	}

	const escapedName = address.name.replace(/"/g, '\\"');

	return `"${escapedName}" <${address.email}>`;
}

/** Extracts the address portion for acceptance metadata; does not validate deliverability. */
export function mailAddressEmail(address: MailAddress): string {
	if (typeof address === 'string') {
		const match = address.match(/<([^>]+)>/);

		return (match?.[1] || address).trim();
	}

	return address.email;
}
