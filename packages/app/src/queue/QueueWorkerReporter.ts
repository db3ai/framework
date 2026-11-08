import { hostname } from 'node:os';
import { ulid } from '@db3.ai/pure/ulid';
import type { QueueWorkerSnapshot, QueueSelection, QueueLogger } from './contracts';

/** Heartbeat interval; status changes are written at once, busy counts ride the next heartbeat. */
const HEARTBEAT_MS = 30_000;

type LaneState = { status: QueueWorkerSnapshot['status']; queue: string | null; jobId: string | null };

/** One execution slot's view of its worker's presence. */
export interface QueueWorkerPresence {
	start(): void;
	update(status: QueueWorkerSnapshot['status'], currentQueue?: string | null, currentJobId?: string | null): void;
	finished(status: string): void;
	stop(): Promise<void>;
}

/**
 * Publishes one presence row for a worker and all of its slots, so a pool of 24 slots writes one
 * heartbeat rather than 24. Writes are serialized; a slow or unavailable sink cannot build an
 * unbounded backlog or stop jobs.
 */
export class QueueWorkerReporter {
	#snapshot: QueueWorkerSnapshot;
	readonly #lanes: LaneState[] = [];
	#timer: ReturnType<typeof setInterval> | null = null;
	#pending: Promise<void> | null = null;
	#dirty = false;

	/** Creates an identity unique to this worker, including multiple workers in the same process. */
	constructor(selection: QueueSelection, private readonly publish: (snapshot: QueueWorkerSnapshot) => Promise<void>, private readonly logger?: QueueLogger) {
		const now = new Date().toISOString();
		this.#snapshot = { id: ulid(), name: process.env.QUEUE_WORKER_NAME || 'queue-worker', hostname: hostname(), pid: process.pid, selection, status: 'stopped', currentQueue: null, currentJobId: null, busy: 0, slots: 0, processed: 0, failed: 0, lastJobAt: null, startedAt: now, heartbeatAt: now };
	}

	/** Adds an execution slot whose state is folded into this worker's single row. */
	lane(): QueueWorkerPresence {
		const state: LaneState = { status: 'stopped', queue: null, jobId: null };
		this.#lanes.push(state);
		this.#snapshot = { ...this.#snapshot, slots: this.#lanes.length };
		return {
			start: () => {
				if (state.status === 'stopped') { state.status = 'idle'; state.queue = null; state.jobId = null; }
				this.#start();
				this.#refresh();
			},
			update: (status, currentQueue = null, currentJobId = null) => {
				if (status === 'stopping') { currentQueue = state.queue; currentJobId = state.jobId; }
				state.status = status; state.queue = currentQueue; state.jobId = currentJobId;
				this.#refresh();
			},
			finished: status => {
				this.#snapshot = { ...this.#snapshot, processed: this.#snapshot.processed + (status === 'succeeded' ? 1 : 0), failed: this.#snapshot.failed + (status === 'failed' ? 1 : 0), lastJobAt: new Date().toISOString() };
			},
			stop: async () => {
				state.status = 'stopped'; state.queue = null; state.jobId = null;
				if (this.#lanes.every(lane => lane.status === 'stopped') && this.#timer) { clearInterval(this.#timer); this.#timer = null; }
				this.#refresh();
				await this.flush();
			},
		};
	}

	/** Starts liveness updates, including while a long job is awaiting network work. */
	#start(): void {
		if (this.#timer) return;
		this.#timer = setInterval(() => { void this.flush(); }, HEARTBEAT_MS);
		this.#timer.unref();
	}

	/** Folds slot states into the row; only a change of overall status is written before the next heartbeat. */
	#refresh(): void {
		const working = this.#lanes.filter(lane => lane.jobId !== null && lane.status !== 'stopped');
		const status: QueueWorkerSnapshot['status'] = this.#lanes.every(lane => lane.status === 'stopped') ? 'stopped'
			: this.#lanes.some(lane => lane.status === 'stopping') ? 'stopping'
			: working.length ? 'busy' : 'idle';
		const previous = this.#snapshot;
		this.#snapshot = { ...previous, status, busy: working.length, currentQueue: working[0]?.queue ?? null, currentJobId: working[0]?.jobId ?? null };
		if (status !== previous.status || (this.#lanes.length === 1 && this.#snapshot.currentJobId !== previous.currentJobId)) void this.flush();
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
