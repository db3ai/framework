import { hostname } from 'node:os';
import { ulid } from '@db3.ai/pure/ulid';
import type { QueueWorkerSnapshot, QueueSelection, QueueLogger } from './contracts';

/** Serializes small presence writes; a slow or unavailable sink cannot build an unbounded backlog or stop jobs. */
export class QueueWorkerReporter {
	#snapshot: QueueWorkerSnapshot;
	#timer: ReturnType<typeof setInterval> | null = null;
	#pending: Promise<void> | null = null;
	#dirty = false;

	/** Creates an identity unique to this worker, including multiple workers in the same process. */
	constructor(selection: QueueSelection, private readonly publish: (snapshot: QueueWorkerSnapshot) => Promise<void>, private readonly logger?: QueueLogger) {
		const now = new Date().toISOString();
		this.#snapshot = { id: ulid(), name: process.env.QUEUE_WORKER_NAME || 'queue-worker', hostname: hostname(), pid: process.pid, selection, status: 'idle', currentQueue: null, currentJobId: null, startedAt: now, heartbeatAt: now };
	}

	/** Starts liveness updates, including while a long job is awaiting network work. */
	start(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => { void this.flush(); }, 10_000);
		this.#timer.unref();
		this.update('idle');
		void this.flush();
	}

	/** Updates the latest state without queuing one database write per job or poll. */
	update(status: QueueWorkerSnapshot['status'], currentQueue: string | null = null, currentJobId: string | null = null): void {
		if (status === 'stopping') { currentQueue = this.#snapshot.currentQueue; currentJobId = this.#snapshot.currentJobId; }
		if (this.#snapshot.status === status && this.#snapshot.currentQueue === currentQueue && this.#snapshot.currentJobId === currentJobId) return;
		this.#snapshot = { ...this.#snapshot, status, currentQueue, currentJobId };
		void this.flush();
	}

	/** Stops timers immediately and flushes a final state when the worker drains. */
	async stop(): Promise<void> {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		this.update('stopped');
		await this.flush();
	}

	/** Coalesces concurrent updates and isolates sink errors from claims and handlers. */
	async flush(): Promise<void> {
		this.#dirty = true;
		if (this.#pending) return this.#pending;
		this.#pending = this.#drain();
		try { await this.#pending; } finally { this.#pending = null; }
	}

	/** Writes the most recent immutable snapshot, retaining changes made while a write was pending. */
	async #drain(): Promise<void> {
		while (this.#dirty) {
			this.#dirty = false;
			try { await this.publish(structuredClone({ ...this.#snapshot, heartbeatAt: new Date().toISOString() })); }
			catch { this.logger?.warn?.('[queue] Unable to publish worker presence.'); }
		}
	}
}
