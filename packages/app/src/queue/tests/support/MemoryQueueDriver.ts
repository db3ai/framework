import type * as queue from '../../contracts';

/**
 * Deterministic in-memory Queue driver used by service-owned behaviour tests.
 */
export class MemoryQueueDriver implements queue.QueueDriver {
	readonly name = 'memory';
	readonly completed: queue.QueueJob[] = [];
	readonly failed: queue.QueueJob[] = [];
	readonly storedFailures: queue.QueueFailedJob[] = [];
	jobs: queue.QueueJob[] = [];
	#nextId = 1;

	/**
	 * Stores a queued job in memory.
	 *
	 * @param input - Queue payload and scheduling values to persist.
	 * @returns Monotonic in-memory job identifier.
	 */
	async push<TData extends Record<string, unknown>>(input: queue.QueueDriverPushInput<TData>): Promise<queue.QueueJobId> {
		const id = this.#nextId++;

		this.jobs.push({
			id,
			queue: input.queue,
			attempts: 0,
			payload: input.payload as queue.JobEnvelope<Record<string, unknown>>,
		});

		return id;
	}

	/**
	 * Claims the first job available on the requested queue.
	 *
	 * @param queueName - Named queue to inspect.
	 * @param _options - Driver claim controls unused by this deterministic driver.
	 * @returns Claimed job, or null when the queue is empty.
	 */
	async pop(queueName: string, _options: queue.QueueDriverPopOptions): Promise<queue.QueueJob | null> {
		const job = this.jobs.find(candidate => candidate.queue === queueName);

		if (!job) return null;

		job.attempts += 1;

		return structuredClone(job);
	}

	/**
	 * Confirms that the claimed attempt still owns its stored job.
	 *
	 * @param job - Claimed queue job.
	 * @returns True when the stored job has the same id and attempt number.
	 */
	async touch(job: queue.QueueJob): Promise<boolean> {
		return this.#owns(job);
	}

	/**
	 * Deletes a successfully completed owned job.
	 *
	 * @param job - Claimed queue job.
	 * @returns True when the job was owned and removed.
	 */
	async delete(job: queue.QueueJob): Promise<boolean> {
		if (!this.#owns(job)) return false;

		this.completed.push(job);
		this.#remove(job);

		return true;
	}

	/**
	 * Releases a failed owned attempt for a later claim.
	 *
	 * @param job - Claimed queue job.
	 * @param _delaySeconds - Retry delay unused by this deterministic driver.
	 * @returns True when the stored attempt was still owned.
	 */
	async release(job: queue.QueueJob, _delaySeconds: number): Promise<boolean> {
		return this.#owns(job);
	}

	/**
	 * Defers an owned job without consuming the current attempt.
	 *
	 * @param job - Claimed queue job.
	 * @param _delaySeconds - Deferral delay unused by this deterministic driver.
	 * @returns True when the job was restored for a later claim.
	 */
	async defer(job: queue.QueueJob, _delaySeconds: number): Promise<boolean> {
		const stored = this.#stored(job);

		if (!stored) return false;

		stored.attempts = Math.max(0, job.attempts - 1);

		return true;
	}

	/**
	 * Records and removes an owned terminal failure.
	 *
	 * @param job - Claimed queue job.
	 * @param _error - Terminal error unused by this deterministic driver.
	 * @returns True when the job was owned and removed.
	 */
	async fail(job: queue.QueueJob, _error: unknown): Promise<boolean> {
		if (!this.#owns(job)) return false;

		this.failed.push(job);
		this.#remove(job);

		return true;
	}

	/**
	 * Returns terminal failures seeded by a service-owned behaviour test.
	 *
	 * @param limit - Maximum number of failures to return.
	 * @returns Seeded failures in their configured order.
	 */
	async failedJobs(limit = 100): Promise<queue.QueueFailedJob[]> {
		return this.storedFailures.slice(0, limit);
	}

	/**
	 * Returns one seeded terminal failure by its driver-owned identifier.
	 *
	 * @param id - Driver-owned failed-job identifier.
	 * @returns Matching failure, or null when it does not exist.
	 */
	async failedJob(id: queue.QueueJobId): Promise<queue.QueueFailedJob | null> {
		return this.storedFailures.find(failure => String(failure.id) === String(id)) ?? null;
	}

	/**
	 * Finds the stored attempt matching one claimed job.
	 *
	 * @param job - Claimed queue job.
	 * @returns Matching stored job, or null when ownership was lost.
	 */
	#stored(job: queue.QueueJob): queue.QueueJob | null {
		return this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		)) ?? null;
	}

	/**
	 * Determines whether one claimed attempt still owns its job.
	 *
	 * @param job - Claimed queue job.
	 * @returns True when the matching stored attempt exists.
	 */
	#owns(job: queue.QueueJob): boolean {
		return this.#stored(job) !== null;
	}

	/**
	 * Removes one job from active in-memory storage.
	 *
	 * @param job - Queue job to remove.
	 */
	#remove(job: queue.QueueJob): void {
		this.jobs = this.jobs.filter(candidate => candidate.id !== job.id);
	}
}
