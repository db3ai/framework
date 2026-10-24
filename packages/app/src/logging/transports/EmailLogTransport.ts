import { AsyncLocalStorage } from 'node:async_hooks';
import type { Mail } from '../../mail';
import type { EmailLogOptions } from '../contracts';
import { formatLogEmail } from '../formatLogEmail';

const deliveringEmail = new AsyncLocalStorage<boolean>();

/**
 * Sends admitted error/fatal records through Mail in arrival order.
 * Pending sends and per-minute admissions are bounded; other log destinations
 * retain suppressed records. Provider failures go directly to stderr.
 */
export class EmailLogTransport {
	#pending: Promise<void> = Promise.resolve();
	#outstanding = 0;
	#admitted = 0;
	#windowStartedAt = Date.now();
	#suppressed = 0;
	readonly #maxPending: number;
	readonly #maxPerMinute: number;

	/** Resolves Mail lazily so constructing an application logger does not initialize mail providers. */
	constructor(readonly options: EmailLogOptions, readonly mail: () => Mail) {
		this.#maxPending = options.maxPending ?? 100;
		this.#maxPerMinute = options.maxPerMinute ?? 60;
		if (![this.#maxPending, this.#maxPerMinute].every(value => Number.isSafeInteger(value) && value > 0)) {
			throw new RangeError('Email log admission limits must be positive integers.');
		}
	}

	/** Accepts Pino JSON lines after serialization and configured field redaction. */
	write(line: string): void {
		if (deliveringEmail.getStore()) return;
		if (Date.now() - this.#windowStartedAt >= 60_000) {
			this.#windowStartedAt = Date.now();
			this.#admitted = 0;
		}
		if (this.#outstanding >= this.#maxPending || this.#admitted >= this.#maxPerMinute) {
			this.#suppressed += 1;
			return;
		}
		try {
			const record = JSON.parse(line) as Record<string, unknown>;
			const message = formatLogEmail(record, this.options);
			this.#outstanding += 1;
			this.#admitted += 1;
			this.#pending = this.#pending.then(() => deliveringEmail.run(true, async () => {
				try {
					await this.mail().send(message);
				} catch {
					// Never include provider errors here: they can contain credentials or request bodies.
					process.stderr.write('[logging] Error email delivery failed; original record remains in configured log destinations.\n');
				}
			})).finally(() => { this.#outstanding -= 1; });
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
		if (this.#suppressed) {
			process.stderr.write(`[logging] Suppressed ${this.#suppressed} error emails at the admission limit; original records remain in configured log destinations.\n`);
			this.#suppressed = 0;
		}
	}
}
