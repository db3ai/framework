import { HttpError } from '../http/errors';

/** Small single-process demo allowance. Not a durable spending cap or billing ledger. */
export class AiAllowance {
	readonly #windows = new Map<string, { until: number; attempts: number }>();
	readonly #active = new Set<string>();

	/** Reserves one attempt; calls must release in finally, including provider failures. */
	acquire(userId: string): () => void {
		const now = Date.now();
		for (const [id, window] of this.#windows) if (window.until <= now) this.#windows.delete(id);
		const window = this.#windows.get(userId) ?? { until: now + 60_000, attempts: 0 };
		if (this.#active.has(userId) || this.#active.size >= 4 || window.attempts >= 10 || this.#windows.size >= 10_000) throw new HttpError(429, 'AI is busy. Wait a minute before trying again.');
		window.attempts += 1;
		this.#windows.set(userId, window);
		this.#active.add(userId);
		return () => { this.#active.delete(userId); };
	}
}
