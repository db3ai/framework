import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db';
import {
	Queue,
	QueueableJob,
	type QueueDriver,
	type QueueDriverPopOptions,
	type QueueJob,
	type QueueJobId,
} from '../../queue';
import {
	millisecondsUntilNextMinute,
	Scheduler,
	SchedulerWorker,
} from '..';

/**
 * Serializable no-op job used to inspect scheduler definitions.
 */
class DefinitionJob extends QueueableJob {
	/**
	 * Creates a no-op job with an empty persisted payload.
	 */
	constructor() {
		super({});
	}

	/**
	 * Completes the no-op job.
	 */
	async handle(): Promise<void> {}
}

/**
 * Minimal queue driver used by scheduler definition tests.
 */
class NullQueueDriver implements QueueDriver {
	readonly name = 'null';

	/**
	 * Accepts a test job without persisting it.
	 *
	 * @returns Constant test job id.
	 */
	async push(): Promise<QueueJobId> {
		return 1;
	}

	/**
	 * Returns no available jobs.
	 *
	 * @returns Null because this driver never stores work.
	 */
	async pop(
		_queue: string,
		_options: QueueDriverPopOptions,
	): Promise<QueueJob | null> {
		return null;
	}

	/**
	 * Confirms a no-op lease.
	 *
	 * @returns True for the definition-only driver.
	 */
	async touch(): Promise<boolean> {
		return true;
	}

	/**
	 * Completes a no-op delete.
	 *
	 * @returns True for the definition-only driver.
	 */
	async delete(): Promise<boolean> {
		return true;
	}

	/**
	 * Completes a no-op release.
	 *
	 * @returns True for the definition-only driver.
	 */
	async release(): Promise<boolean> {
		return true;
	}

	/**
	 * Completes a no-op deferral.
	 *
	 * @returns True for the definition-only driver.
	 */
	async defer(): Promise<boolean> {
		return true;
	}

	/**
	 * Completes a no-op terminal failure.
	 *
	 * @returns True for the definition-only driver.
	 */
	async fail(): Promise<boolean> {
		return true;
	}
}

/**
 * Creates a scheduler whose database is not used by definition-only tests.
 *
 * @returns Scheduler with a no-op queue driver.
 */
function definitionScheduler(): Scheduler {
	const queue = new Queue({} as Database, {
		driver: new NullQueueDriver(),
	});

	return new Scheduler({} as Database, queue);
}

/**
 * Creates one successful scheduler run result.
 *
 * @param evaluatedFor - UTC minute represented by the result.
 * @returns Empty successful scheduler result.
 */
function successfulRun(evaluatedFor: Date) {
	return {
		evaluatedFor,
		startedAt: evaluatedFor,
		finishedAt: evaluatedFor,
		due: 0,
		claimed: 0,
		dispatched: 0,
		completed: 0,
		skipped: 0,
		failures: [],
	};
}

describe('Scheduler definitions', () => {
	it('supports hourly UTC boundaries, including local daylight-saving changes', () => {
		const scheduler = definitionScheduler();
		const event = scheduler.job(DefinitionJob).hourly().timezone('Asia/Kolkata');
		expect(scheduler.definitions()[0].frequency).toEqual({ type: 'hourly' });
		for (const time of ['2026-03-29T00:00:00Z', '2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z']) expect(event.isDue(new Date(time))).toBe(true);
		for (const time of ['2026-03-29T00:01:00Z', '2026-03-29T00:30:00Z', 'invalid']) expect(event.isDue(new Date(time))).toBe(false);
		event.everyMinute();
		expect(event.isDue(new Date('2026-03-29T00:30:00Z'))).toBe(true);
		scheduler.close();
	});

	it('owns schedule groups, rejects duplicate declarations atomically and cleans up idempotently', () => {
		const scheduler = definitionScheduler();
		scheduler.job(DefinitionJob).name('host.daily').daily();
		const social = scheduler.register('social', schedule => { schedule.job(DefinitionJob).name('review').hourly(); });
		expect(social.definitions[0]).toMatchObject({ name: 'social.review', owner: 'social', frequency: { type: 'hourly' } });
		expect(() => scheduler.register('social', () => {})).toThrow('duplicate');
		expect(() => scheduler.register('broken', schedule => { schedule.job(DefinitionJob).name('same').hourly(); schedule.job(DefinitionJob).name('same').daily(); })).toThrow('Duplicate');
		expect(scheduler.definitions()).toHaveLength(2);
		social.close(); social.close();
		expect(scheduler.definitions().map(event => event.name)).toEqual(['host.daily']);
		scheduler.register('social', schedule => { schedule.job(DefinitionJob).hourly(); }).close();
		scheduler.close();
	});

	it('evaluates minute schedules across timezone transitions and supports changing frequency', () => {
		const scheduler = definitionScheduler();
		const event = scheduler.job(DefinitionJob).everyMinute().timezone('Europe/London');
		expect(scheduler.definitions()[0]?.frequency).toEqual({ type: 'minute' });
		for (const instant of ['2026-03-29T00:59:00Z', '2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z']) {
			expect(event.isDue(new Date(instant))).toBe(true);
		}
		expect(event.isDue(new Date('invalid'))).toBe(false);
		event.dailyAt('12:00');
		expect(event.isDue(new Date('2026-03-29T01:00:00Z'))).toBe(false);
		scheduler.close();
	});

	it('uses a QueueableJob class name as the optional schedule name', () => {
		const scheduler = definitionScheduler();

		scheduler.job(DefinitionJob)
			.dailyAt('02:00')
			.timezone('Europe/London');

		expect(scheduler.definitions()).toEqual([{
			name: 'DefinitionJob',
			kind: 'job',
			jobName: 'DefinitionJob',
			frequency: {
				type: 'daily',
				time: '02:00',
			},
			timezone: 'Europe/London',
		}]);

		scheduler.close();
	});

	it('requires stable names for factories and inline calls', () => {
		const factoryScheduler = definitionScheduler();

		factoryScheduler.job(() => new DefinitionJob()).daily();

		expect(() => factoryScheduler.definitions()).toThrow(
			'requires an explicit stable name',
		);
		factoryScheduler.close();

		const callScheduler = definitionScheduler();

		callScheduler.call(() => {}).daily();

		expect(() => callScheduler.definitions()).toThrow(
			'requires an explicit stable name',
		);
		callScheduler.close();
	});

	it('accepts explicit stable names for factories and inline calls', () => {
		const scheduler = definitionScheduler();

		scheduler.job(() => new DefinitionJob())
			.name('parameterised-job')
			.daily();
		scheduler.call(() => {})
			.name('short-cleanup')
			.dailyAt('03:15');

		expect(scheduler.definitions().map(definition => definition.name)).toEqual([
			'parameterised-job',
			'short-cleanup',
		]);

		scheduler.close();
	});

	it('rejects duplicate names and invalid timing configuration', () => {
		const scheduler = definitionScheduler();

		scheduler.job(DefinitionJob).daily();
		scheduler.call(() => {}).name('DefinitionJob').dailyAt('01:00');

		expect(() => scheduler.definitions()).toThrow(
			'Duplicate scheduled event name "DefinitionJob"',
		);
		expect(() => definitionScheduler().job(DefinitionJob).dailyAt('2:00')).toThrow(
			'Use HH:mm',
		);
		expect(() => definitionScheduler().job(DefinitionJob).daily().timezone('Mars/Olympus')).toThrow(
			'Use an IANA timezone name',
		);

		scheduler.close();
	});

	it('evaluates daily times in the configured daylight-saving timezone', () => {
		const scheduler = definitionScheduler();
		const event = scheduler.job(DefinitionJob)
			.dailyAt('02:00')
			.timezone('Europe/London');

		expect(event.isDue(new Date('2026-07-23T01:00:00.000Z'))).toBe(true);
		expect(event.isDue(new Date('2026-01-23T02:00:00.000Z'))).toBe(true);
		expect(event.isDue(new Date('2026-07-23T02:00:00.000Z'))).toBe(false);

		scheduler.close();
	});
});

describe('SchedulerWorker', () => {
	it('runs immediately and waits until the next minute boundary', async () => {
		const now = new Date('2026-07-23T12:00:30.250Z');
		const runDue = vi.fn(async () => successfulRun(now));
		const onTick = vi.fn(async () => undefined);
		let worker: SchedulerWorker;
		const sleep = vi.fn(async (
			_delayMs: number,
			_signal: AbortSignal,
		) => {
			worker.stop();
		});

		worker = new SchedulerWorker({
			runDue,
		} as unknown as Scheduler, {
			now: () => now,
			sleep,
			onTick,
		});

		await worker.start();

		expect(runDue).toHaveBeenCalledOnce();
		expect(onTick).toHaveBeenCalledOnce();
		expect(runDue).toHaveBeenCalledWith(new Date('2026-07-23T12:00:00.000Z'));
		expect(sleep).toHaveBeenCalledWith(29_750, expect.any(AbortSignal));
	});

	it('keeps running after an isolated tick failure', async () => {
		const now = new Date('2026-07-23T12:00:00.000Z');
		const runDue = vi.fn()
			.mockRejectedValueOnce(new Error('Temporary database outage.'))
			.mockResolvedValue(successfulRun(now));
		const logger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};
		const onTick = vi.fn(async () => undefined);
		let sleeps = 0;
		let worker: SchedulerWorker;

		worker = new SchedulerWorker({
			runDue,
		} as unknown as Scheduler, {
			now: () => now,
			logger,
			onTick,
			sleep: async () => {
				sleeps += 1;

				if (sleeps >= 2) worker.stop();
			},
		});

		await worker.start();

		expect(runDue).toHaveBeenCalledTimes(2);
		expect(onTick).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith(
			'[scheduler] Evaluation for 2026-07-23T12:00:00.000Z did not finish; retrying the same minute.',
			expect.any(Error),
		);
	});

	it('calculates bounded delays to the next minute', () => {
		expect(millisecondsUntilNextMinute(
			new Date('2026-07-23T12:00:00.000Z'),
		)).toBe(60_000);
		expect(millisecondsUntilNextMinute(
			new Date('2026-07-23T12:00:59.999Z'),
		)).toBe(1);
	});
});
