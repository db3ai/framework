import { AsyncLocalStorage } from 'node:async_hooks';
import type { Mail } from '../../mail';
import type { EmailLogOptions } from '../contracts';
import { formatLogEmail } from '../formatLogEmail';

const deliveringEmail = new AsyncLocalStorage<boolean>();

/**
 * Sends each serialized error/fatal log through Mail once, in arrival order.
 * Pending sends live in memory; flush/close drains them. Provider failures go to
 * stderr without recursive logging, retry, cooldown, grouping or suppression of later records.
 */
export class EmailLogTransport {
	#pending: Promise<void> = Promise.resolve();

	/** Resolves Mail lazily so constructing an application logger does not initialize mail providers. */
	constructor(readonly options: EmailLogOptions, readonly mail: () => Mail) {}

	/** Accepts Pino JSON lines after serialization and configured field redaction. */
	write(line: string): void {
		if (deliveringEmail.getStore()) return;
		try {
			const record = JSON.parse(line) as Record<string, unknown>;
			const message = formatLogEmail(record, this.options);
			this.#pending = this.#pending.then(() => deliveringEmail.run(true, async () => {
				try {
					await this.mail().send(message);
				} catch {
					// Never include provider errors here: they can contain credentials or request bodies.
					process.stderr.write('[logging] Error email delivery failed; original record remains in configured log destinations.\n');
				}
			}));
		} catch {
			process.stderr.write('[logging] Error email formatting failed; original record remains in configured log destinations.\n');
		}
	}

	/** Waits for all accepted sends, including records appended while a flush is in progress. */
	async flush(): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.#pending;
			await pending;
		} while (pending !== this.#pending);
	}
}
