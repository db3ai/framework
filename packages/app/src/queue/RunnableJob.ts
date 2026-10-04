import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ActiveRecord } from '../db/ActiveRecord';
import { JobRunAttempt } from './JobRunAttempt';
import { JobRunEvent } from './JobRunEvent';
import { JobRunStoppedError } from './JobRunStoppedError';
import { QueueTerminalError } from './QueueTerminalError';
import { isQueueRetryLaterError } from './QueueRetryLaterError';
import type { Queue } from './Queue';
import type { DispatchOptions, QueueJobId, QueueableJobContext, QueueableJobContract, QueueableJobFailureContext, QueueableJobRetryContext, SerializedQueueableJob } from './contracts';

/** Persisted lifecycle values; waiting includes scheduled retries, blocked requires an explicit new run. */
export const JOB_RUN_STATUSES = ['waiting', 'running', 'blocked', 'completed', 'failed', 'cancelled'] as const;

/**
 * A retained run with application-owned input, state and behaviour. Register only
 * this base model in migrations; concrete job classes share its table. Jobs must
 * use checkpoint/save for durable work and make external effects idempotent.
 * Tenant and subject identities are immutable; applications authorize launches
 * and reads. Queue serialization contains only the saved run ID and generation.
 */
export class RunnableJob extends ActiveRecord.define({
	table: 'job_runs',
	fields: field => ({
		id: field.ulid(),
		jobType: field.string({ column: 'job_type', required: true, length: 200, index: true }),
		tenantId: field.string({ column: 'tenant_id', required: true, length: 100, indexes: [{ name: 'job_runs_tenant_history', columns: ['tenant_id', 'id'] }] }),
		subjectId: field.string({ column: 'subject_id', length: 100, indexes: [{ name: 'job_runs_subject_history', columns: ['subject_id', 'id'] }] }),
		actorId: field.string({ column: 'actor_id', length: 100 }),
		parentRunId: field.string({ column: 'parent_run_id', length: 26, index: true }),
		trigger: field.string({ required: true, default: 'manual', length: 40 }),
		status: field.choice({ choices: [...JOB_RUN_STATUSES], required: true, default: 'waiting', index: true }),
		input: field.json<Record<string, unknown>>({ required: true, default: {}, comment: 'Immutable application inputs captured when the run is created.' }),
		state: field.json<Record<string, unknown>>({ required: true, default: {}, comment: 'Mutable application checkpoint for progress, diagnosis and explicit recovery; may contain private data.' }),
		result: field.json<Record<string, unknown>>({ comment: 'Application outcome or result summary, separate from mutable progress state.' }),
		error: field.text(),
		stage: field.string({ length: 200, comment: 'Job-owned current phase; lifecycle outcome is stored in status.' }),
		completed: field.integer({ required: true, default: 0, comment: 'Job-owned processed unit count, e.g. pages scanned or 1 for one operation; not a completion flag.' }),
		total: field.integer({ comment: 'Planned units in the same measure as completed; null when unknown.' }),
		failures: field.integer({ required: true, default: 0, comment: 'Job-owned failed unit count; units may also be counted as completed. Job failure is recorded in status.' }),
		attemptCount: field.integer({ column: 'attempt_count', required: true, default: 0 }),
		deliveryKey: field.string({ column: 'delivery_key', length: 36 }),
		leaseToken: field.string({ column: 'lease_token', length: 36 }),
		cancelRequestedAt: field.timestamp({ column: 'cancel_requested_at' }),
		queuedAt: field.timestamp({ column: 'queued_at' }),
		startedAt: field.timestamp({ column: 'started_at' }),
		heartbeatAt: field.timestamp({ column: 'heartbeat_at' }),
		completedAt: field.timestamp({ column: 'completed_at' }),
		createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		updatedAt: field.timestamp({ column: 'updated_at', auto: 'update' }),
	}),
}) implements QueueableJobContract {
	/** Stable name may be overridden to preserve queued identities across class renames. */
	static jobName?: string;
	static #active = new AsyncLocalStorage<RunnableJob>();

	/** Returns the active run for child dispatch correlation within this asynchronous execution only. */
	static current(): RunnableJob | undefined { return RunnableJob.#active.getStore(); }
	#context: QueueableJobContext | null = null;
	#token: string | null = null;
	#updates: Promise<unknown> = Promise.resolve();
	#stop = new AbortController();
	#publishing = false;

	/** Internal dispatch guard; a saved delivery cannot be enqueued twice through the public API. */
	get publishingDelivery(): boolean { return this.#publishing; }

	/** Cooperative abort signal. Application requests should combine it with their own deadline. */
	get signal(): AbortSignal { return this.#stop.signal; }

	/** Loads the authoritative run through its concrete registered class, rejecting mismatched deliveries. */
	static async fromJSON<T extends typeof RunnableJob>(this: T, data: Record<string, unknown>): Promise<InstanceType<T>> {
		if (typeof data.runId !== 'string' || typeof data.deliveryKey !== 'string') throw new Error('Invalid runnable job reference.');
		const run = await this.findOrFail(data.runId);
		if (run.jobType !== (this.jobName ?? this.name) || run.deliveryKey !== data.deliveryKey) throw new Error('Runnable job identity does not match its delivery.');
		return run as InstanceType<T>;
	}

	/** Saves a new run before dispatch. During execution, saves only application-owned fields under the attempt fence. */
	override async save(): Promise<this> {
		if (!this.isPersisted()) {
			if (this.constructor === RunnableJob) throw new Error('Create a concrete RunnableJob subclass.');
			this.jobType = (this.constructor as typeof RunnableJob).jobName ?? this.constructor.name;
			return super.save();
		}
		if (!this.#token) throw new Error('Existing run records may only be saved by their owning execution.');
		const values = structuredClone({ state: this.state, result: this.result, stage: this.stage, completed: this.completed, total: this.total, failures: this.failures });
		await this.#serializeUpdate(() => this.#write(values));
		return this;
	}

	/** Serializes concurrent progress callbacks so state merges cannot lose another completed item's update. */
	async checkpoint(update: (run: this) => void): Promise<void> {
		await this.#serializeUpdate(async () => {
			await this.assertActive();
			update(this);
			await this.#write({ state: this.state, result: this.result, stage: this.stage, completed: this.completed, total: this.total, failures: this.failures });
		});
	}

	/** Checks delivery ownership and operator cancellation before launching or publishing another unit of work. */
	async assertActive(): Promise<void> {
		this.signal.throwIfAborted();
		await this.#context?.assertOwnership?.();
		const row = await RunnableJob.where({ id: this.id, leaseToken: this.#token, status: 'running' }).first();
		if (!this.#token || !row) throw new Error('Runnable job execution ownership was lost.');
		let cancellation = Boolean(row.cancelRequestedAt);
		let parentId = row.parentRunId;
		const visited = new Set<string>();
		while (!cancellation && parentId) {
			if (visited.has(parentId) || visited.size >= 32) throw new Error('Invalid run ancestry.');
			visited.add(parentId);
			const parent = await RunnableJob.find(parentId);
			cancellation = Boolean(parent?.cancelRequestedAt);
			parentId = parent?.parentRunId ?? null;
		}
		if (cancellation) {
			const reason = new JobRunStoppedError('cancelled', 'Cancelled by the operator.');
			this.#stop.abort(reason);
			throw reason;
		}
	}

	/** Appends bounded structured diagnostics; callers must omit credentials and private provider payloads. */
	async log(message: string, data: Record<string, unknown> = {}, level: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
		await this.assertActive();
		if (JSON.stringify(data).length > 16000) throw new Error('Job event data exceeds 16,000 characters.');
		await JobRunEvent.create({ runId: this.id, tenantId: this.tenantId, attempt: this.attemptCount, message: message.slice(0, 1024), data, level }).save();
	}

	/** Stops launching further work until an operator creates a resumed run using the saved checkpoint. */
	block(reason: string): never { throw new JobRunStoppedError('blocked', reason); }

	/** Resolves application-owned input/scope before first persistence. Override in a tenant-aware application base class. */
	async prepare(): Promise<void> {}

	/** Saves a run and its dispatch generation before delivery. Failed dispatches remain visible in history. */
	async enqueue(queue: Queue, options: DispatchOptions = {}): Promise<QueueJobId> {
		if (this.deliveryKey) throw new Error('This run has already been dispatched.');
		if (!this.isPersisted()) { await this.prepare(); await this.save(); }
		const key = randomUUID();
		let reserved = false;
		/** Reserves the delivery generation and publishes its small queue reference. */
		const publish = async (): Promise<QueueJobId> => {
			const changed = await RunnableJob.where({ id: this.id, status: 'waiting' }).whereNull('deliveryKey').patch({ deliveryKey: key, queuedAt: new Date() });
			if (changed !== 1) throw new Error('This run has already been dispatched.');
			reserved = true;
			this.deliveryKey = key;
			this.#publishing = true;
			try { return await queue.dispatch(this, options); } finally { this.#publishing = false; }
		};
		try {
			return queue.driverName === 'database'
				? await RunnableJob.getDb().transaction(transaction => ActiveRecord.withDb(transaction, publish))
				: await publish();
		}
		catch (error) {
			if (!reserved) throw error;
			const failedDispatch = RunnableJob.where({ id: this.id, status: 'waiting' });
			if (queue.driverName === 'database') failedDispatch.whereNull('deliveryKey'); else failedDispatch.where('deliveryKey', key);
			await failedDispatch.patch({ status: 'failed', error: `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`, completedAt: new Date() });
			throw error;
		}
	}

	/** Produces a small immutable queue reference; never copies mutable model JSON into delivery storage. */
	serialize(): SerializedQueueableJob {
		if (!this.isPersisted() || !this.deliveryKey) throw new Error('Call run.enqueue(queue) before queueing a runnable record.');
		return { job: this.jobType!, displayName: this.jobType!, data: { runId: this.id, deliveryKey: this.deliveryKey } };
	}

	/** Concrete application jobs implement their own bounded work, checkpoints and result publication. */
	async handle(_context: QueueableJobContext): Promise<void> { throw new Error('RunnableJob.handle must be implemented.'); }

	/** Lifecycle is saved before delivery transitions; ordinary queue retry hooks are intentionally empty. */
	async onRetry(_context: QueueableJobRetryContext): Promise<void> {}
	/** Lifecycle is saved before delivery transitions, including terminal failure. */
	async onFinalFailure(context: QueueableJobFailureContext): Promise<void> {
		// A deadline can pass between handler failure and the driver's final disposition.
		const error = context.error instanceof Error ? context.error.message : String(context.error);
		await RunnableJob.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const changed = await RunnableJob.where({ id: this.id, status: 'waiting', attemptCount: this.attemptCount }).patch({ status: 'failed', error, completedAt: new Date() });
			if (changed) {
				await JobRunAttempt.where({ runId: this.id, attempt: this.attemptCount, status: 'retrying' }).patch({ status: 'failed', error });
				await JobRunEvent.create({ runId: this.id, tenantId: this.tenantId, attempt: this.attemptCount, level: 'error', message: error.slice(0, 1024), data: { status: 'failed', queue: context.job.queue, deliveryId: context.job.id, jobUuid: context.job.payload.uuid, maxTries: context.job.payload.maxTries } }).save();
				this.status = 'failed';
			}
		}));
	}

	/** Runs one fenced attempt. Expired delivery recovery preserves checkpoints and records the interrupted attempt. */
	async execute(context: QueueableJobContext): Promise<void> {
		await context.assertOwnership?.();
		this.#context = context;
		this.#updates = Promise.resolve();
		const token = randomUUID();
		const claimed = await RunnableJob.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const raw = await RunnableJob.where('id', this.id).toKnex().forUpdate().first();
			if (!raw) throw new Error('Run no longer exists.');
			const current = RunnableJob.fromDb(raw);
			if (current.deliveryKey !== this.deliveryKey) throw new Error('Run delivery was replaced.');
			if (!['waiting', 'running'].includes(current.status ?? '')) return false;
			if (current.status === 'running') await JobRunAttempt.where({ runId: this.id, status: 'running' }).patch({ status: 'interrupted', completedAt: new Date(), error: 'Worker reservation expired before completion.' });
			const now = new Date();
			const values = { status: 'running' as const, leaseToken: token, attemptCount: (current.attemptCount ?? 0) + 1, startedAt: current.startedAt ?? now, heartbeatAt: now, completedAt: null, error: null };
			await RunnableJob.where('id', this.id).patch(values);
			this.assign({ ...current.toJSON(), ...values });
			await JobRunAttempt.create({ runId: this.id, tenantId: this.tenantId, attempt: this.attemptCount, deliveryId: String(context.job.id), status: 'running', startedAt: now }).save();
			return true;
		}));
		if (!claimed) return;
		this.#token = token;
		this.#stop = new AbortController();
		let heartbeat: Promise<void> = Promise.resolve();
		const timer = setInterval(() => {
			heartbeat = heartbeat.then(async () => {
				await this.assertActive();
				await RunnableJob.where({ id: this.id, leaseToken: token }).patch({ heartbeatAt: new Date() });
			}).catch(error => { this.#stop.abort(error); });
		}, 10000);
		try {
			await this.log('Attempt started');
			await RunnableJob.#active.run(this, () => this.handle(context));
			await this.#updates;
			await this.assertActive();
			await this.#finish('completed', null);
		} catch (error) {
			await this.#updates.catch(() => undefined);
			await context.assertOwnership?.();
			const stopped = error instanceof JobRunStoppedError;
			const retry = context.willRetry ? context.willRetry(error) : isQueueRetryLaterError(error) || !(error instanceof QueueTerminalError) && context.job.attempts < context.job.payload.maxTries;
			const status = stopped ? error.status : retry ? 'waiting' : 'failed';
			await this.#finish(status, error instanceof Error ? error.message : String(error));
			if (!stopped) throw error;
		} finally {
			clearInterval(timer);
			await heartbeat;
			this.#context = null;
			this.#token = null;
		}
	}

	/** Writes application-owned state with a database fence; unrelated runtime fields cannot be overwritten. */
	async #write(values: Record<string, unknown>): Promise<void> {
		await this.assertActive();
		if (JSON.stringify(values).length > 1000000) throw new Error('Run checkpoint exceeds one megabyte. Store large evidence separately.');
		const count = await RunnableJob.where({ id: this.id, leaseToken: this.#token, status: 'running' }).whereNull('cancelRequestedAt').patch({ ...values, heartbeatAt: new Date(), updatedAt: new Date() });
		if (count !== 1) {
			await this.assertActive();
			throw new Error('Runnable job checkpoint ownership was lost.');
		}
	}

	/** Records terminal/retry state, attempt outcome and timeline in the same transaction. */
	async #finish(status: typeof JOB_RUN_STATUSES[number], error: string | null): Promise<void> {
		await RunnableJob.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const now = new Date();
			const changed = await RunnableJob.where({ id: this.id, leaseToken: this.#token, status: 'running' }).patch({ status, error, completedAt: status === 'waiting' ? null : now, heartbeatAt: now, leaseToken: null, updatedAt: now });
			if (changed !== 1) throw new Error('Runnable job completion ownership was lost.');
			await JobRunAttempt.where({ runId: this.id, attempt: this.attemptCount, status: 'running' }).patch({ status: status === 'waiting' ? 'retrying' : status, error, completedAt: now });
			await JobRunEvent.create({ runId: this.id, tenantId: this.tenantId, attempt: this.attemptCount, level: status === 'failed' ? 'error' : error ? 'warning' : 'info', message: error?.slice(0, 1024) ?? 'Run completed', data: { status, queue: this.#context?.job.queue, deliveryId: this.#context?.job.id, jobUuid: this.#context?.job.payload.uuid, maxTries: this.#context?.job.payload.maxTries } }).save();
			this.status = status;
		}));
	}

	/** Queues state writes on this instance while allowing callers to observe their own failures. */
	#serializeUpdate(action: () => Promise<void>): Promise<void> {
		const next = this.#updates.then(action);
		this.#updates = next;
		return next;
	}
}
