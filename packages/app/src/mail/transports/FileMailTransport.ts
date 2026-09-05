import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
	formatMailAddress,
	mailAddressEmail,
	type MailDelivery,
	type MailTransport,
	type ResolvedMailMessage,
} from '../Mail.js';

export interface FileMailTransportOptions {
	directory?: string;
}

/**
 * Development mail transport that writes each message to disk.
 */
export class FileMailTransport implements MailTransport {
	private readonly directory: string;

	constructor(options: FileMailTransportOptions = {}) {
		this.directory = options.directory || join(process.cwd(), 'storage', 'mail');
	}

	async send(message: ResolvedMailMessage): Promise<MailDelivery> {
		await mkdir(this.directory, {
			recursive: true,
		});

		const id = randomUUID();
		const createdAt = new Date().toISOString();
		const fileName = `${createdAt.replace(/[:.]/g, '-')}-${id}.json`;
		const path = join(this.directory, fileName);
		const accepted = message.to.map(mailAddressEmail);
		const payload = {
			id,
			createdAt,
			from: formatMailAddress(message.from),
			to: message.to.map(formatMailAddress),
			subject: message.subject,
			text: message.text ?? null,
			html: message.html ?? null,
			headers: message.headers ?? {},
		};

		await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

		return {
			id,
			transport: 'file',
			accepted,
			rejected: [],
			path,
		};
	}
}
