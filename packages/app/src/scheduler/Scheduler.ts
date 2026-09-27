import { ActiveRecord, type Database } from '../db';
import { isQueueableJobClass, queueableJobName, type Queue } from '../queue';
import { SCHEDULED_OCCURRENCE_ORIGIN } from './constants';
import type * as scheduler from './contracts';
import { ScheduledCall } from './ScheduledCall';
import { ScheduledEvent } from './ScheduledEvent';
import { ScheduledJob } from './ScheduledJob';
import { ScheduledOccurrence } from './ScheduledOccurrence';
import { ScheduledOccurrenceRecorder, errorDetails } from './ScheduledOccurrenceRecorder';
import { utcMinute } from './scheduleTime';

/**
 * Registers daily tasks, atomically claims due occurrences, and dispatches work.
 */
export class Scheduler {
	readonly #events: ScheduledEvent[] = [];
	readonly #owners = new Map<ScheduledEvent, { owner: string; run: scheduler.ScheduleRunner }>();
	readonly #groups = new Set<string>();
	readonly #unsubscribeQueueEvents: () => void;

	/**
	 * Creates a scheduler and attaches durable queue lifecycle recording.
	 *
	 * @param database - Application database containing occurrence history.
	 * @param queue - Queue used to dispatch scheduled jobs.
	 */
	constructor(
		private readonly database: Database,
		private readonly queue: Queue,
	) {
		const recorder = new ScheduledOccurrenceRecorder(database);

		this.#unsubscribeQueueEvents = queue.events.subscribe(event => {
			return recorder.record(event);
		});
	}

	/**
	 * Registers a QueueableJob class or fresh-job factory.
	 *
	 * @param source - Zero-argument job class or parameterised factory.
	 * @returns Fluent scheduled job definition.
	 */
	job(source: scheduler.ScheduledJobSource): ScheduledJob {
		const event = new ScheduledJob(source);

		this.#events.push(event);

		return event;
	}

	/**
	 * Registers a short inline callback.
	 *
	 * @param callback - Callback executed directly by the scheduler worker.
	 * @returns Fluent scheduled call definition.
	 */
	call(callback: scheduler.ScheduledCallHandler): ScheduledCall {
		const event = new ScheduledCall(callback);

		this.#events.push(event);

		return event;
	}

	/**
	 * Atomically registers an owned schedule group. Declarations are synchronous and do not execute jobs.
	 * Names are prefixed with the owner unless already namespaced. Failed declarations register nothing.
	 */
	register(owner: string, configure: (schedule: scheduler.Schedule) => void, run: scheduler.ScheduleRunner = operation => operation()): scheduler.ScheduleRegistration {
		if (!/^[a-z][a-z0-9_]{0,39}$/.test(owner) || this.#groups.has(owner)) throw new Error(`Invalid or duplicate schedule owner "${owner}".`);
		const events: ScheduledEvent[] = [];
		const declaration = configure({
			/** Collects a queued declaration without attaching it to the running scheduler yet. */
			job: source => { const event = new ScheduledJob(source); events.push(event); return event; },
			/** Collects a short callback under the same group ownership. */
			call: handler => { const event = new ScheduledCall(handler); events.push(event); return event; },
		}) as unknown;
		if (declaration && typeof (declaration as Promise<unknown>).then === 'function') throw new Error('Schedule declarations must be synchronous.');
		const names = new Set(this.definitions().map(definition => definition.name));
		const definitions = events.map(event => {
			const name = event.definition().name;
			if (!name.startsWith(`${owner}.`)) event.name(`${owner}.${name}`);
			const definition = { ...event.definition(), owner };
			if (names.has(definition.name)) throw new Error(`Duplicate scheduled event name "${definition.name}".`);
			names.add(definition.name);
			return definition;
		});
		this.#groups.add(owner);
		for (const event of events) { this.#events.push(event); this.#owners.set(event, { owner, run }); }
		let closed = false;
		return { definitions, close: () => {
			if (closed) return;
			closed = true;
			for (const event of events) { this.#events.splice(this.#events.indexOf(event), 1); this.#owners.delete(event); }
			this.#groups.delete(owner);
		} };
	}

	/**
	 * Returns validated normalized definitions in registration order.
	 *
	 * @returns Registered scheduler definitions.
	 */
	definitions(): scheduler.ScheduledTaskDefinition[] {
		const definitions = this.#events.map(event => ({ ...event.definition(), ...(this.#owners.has(event) ? { owner: this.#owners.get(event)!.owner } : {}) }));
		const names = new Set<string>();

		for (const definition of definitions) {
			if (names.has(definition.name)) {
				throw new Error(`Duplicate scheduled event name "${definition.name}".`);
			}

			names.add(definition.name);
		}

		return definitions;
	}

	/**
	 * Evaluates and handles every task due for one canonical UTC minute.
	 *
	 * Due tasks run sequentially in registration order. Immediate failures are
	 * recorded and aggregated so one task cannot prevent later tasks from being
	 * considered.
	 *
	 * @param now - Instant whose UTC minute should be evaluated.
	 * @returns Structured evaluation summary.
	 */
	async runDue(now: Date = new Date()): Promise<scheduler.SchedulerRunResult> {
		const startedAt = new Date();
		const evaluatedFor = utcMinute(now);

		this.definitions();

		const dueEvents = this.#events.filter(event => event.isDue(evaluatedFor));
		const result: scheduler.SchedulerRunResult = {
			evaluatedFor,
			startedAt,
			finishedAt: startedAt,
			due: dueEvents.length,
			claimed: 0,
			dispatched: 0,
			completed: 0,
			skipped: 0,
			failures: [],
		};

		for (const event of dueEvents) {
			const owner = this.#owners.get(event);
			/** Runs a complete occurrence inside its registration owner's lifecycle gate. */
			const execute = async (): Promise<void> => {
				if (!this.#events.includes(event)) { result.skipped++; return; }
				const definition = event.definition();
				const occurrence = await ActiveRecord.withDb(this.database.knex, () => {
					return ScheduledOccurrence.claim({
						name: definition.name,
						kind: definition.kind,
						scheduledFor: evaluatedFor,
						jobName: definition.jobName,
					});
				});

				if (!occurrence) {
					result.skipped += 1;
					return;
				}

				result.claimed += 1;

				try {
					if (event instanceof ScheduledJob) {
						await this.dispatchJob(event, occurrence);
						result.dispatched += 1;
					} else if (event instanceof ScheduledCall) {
						await this.runCall(event, occurrence);
						result.completed += 1;
					}
				} catch (error) {
					await this.failOccurrence(occurrence, error);
					result.failures.push({
						name: definition.name,
						error: errorDetails(error),
					});
				}
			};
			if (!owner) await execute();
			else {
				try { await owner.run(execute); }
				catch (error) { result.failures.push({ name: event.definition().name, error: errorDetails(error) }); }
			}
		}

		result.finishedAt = new Date();

		return result;
	}

	/**
	 * Detaches queue lifecycle recording owned by this scheduler instance.
	 */
	close(): void {
		this.#unsubscribeQueueEvents();
	}

	/**
	 * Creates and dispatches one job with occurrence origin metadata.
	 *
	 * @param event - Claimed scheduled job definition.
	 * @param occurrence - Durable occurrence receiving queue events.
	 */
	private async dispatchJob(
		event: ScheduledJob,
		occurrence: ScheduledOccurrence,
	): Promise<void> {
		const job = event.createJob();
		const Job = job.constructor;

		occurrence.jobName = isQueueableJobClass(Job)
			? queueableJobName(Job)
			: Job.name;
		await ActiveRecord.withDb(this.database.knex, () => occurrence.save());

		await this.queue.dispatch(job, {
			origin: {
				type: SCHEDULED_OCCURRENCE_ORIGIN,
				id: occurrence.id as string,
			},
		});
	}

	/**
	 * Runs one short inline callback and records its terminal state.
	 *
	 * @param event - Claimed scheduled callback.
	 * @param occurrence - Durable occurrence to update.
	 */
	private async runCall(
		event: ScheduledCall,
		occurrence: ScheduledOccurrence,
	): Promise<void> {
		const startedAt = new Date();

		occurrence.status = 'running';
		occurrence.startedAt = startedAt;
		await ActiveRecord.withDb(this.database.knex, () => occurrence.save());
		await event.run();

		occurrence.status = 'succeeded';
		occurrence.finishedAt = new Date();
		await ActiveRecord.withDb(this.database.knex, () => occurrence.save());
	}

	/**
	 * Records an immediate dispatch, factory, or inline callback failure.
	 *
	 * @param occurrence - Claimed occurrence that failed.
	 * @param error - Immediate scheduler error.
	 */
	private async failOccurrence(
		occurrence: ScheduledOccurrence,
		error: unknown,
	): Promise<void> {
		occurrence.status = 'failed';
		occurrence.lastError = errorDetails(error);
		occurrence.nextAttemptAt = null;
		occurrence.finishedAt = new Date();

		await ActiveRecord.withDb(this.database.knex, () => occurrence.save());
	}
}
