import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../db';
import { App } from '../../../server';
import { GenerateReportJob } from '../../examples/GenerateReportJob';
import { dispatchGenerateReportJob, processNextReportJob, registerGenerateReportJob } from '../../examples/createAndProcessReportJob';
import { dispatchReportBatch, dispatchReportPipeline } from '../../examples/dispatchReportWorkflows';
import { dispatchReportWithRetryPolicy, retryFailedReportJob, retryReportAfterBackpressure } from '../../examples/manageReportRetries';
import { Queue } from '../../index';
import { MemoryQueueDriver } from '../support/MemoryQueueDriver';

let application: App | null = null;

/**
 * Reads one deterministic output rendered by the documentation website.
 *
 * @param fileName - Output fixture name beneath the Queue examples directory.
 * @returns Parsed example output asserted by this behaviour suite.
 */
function readExampleOutput<TOutput>(fileName: string): TOutput {
	return JSON.parse(readFileSync(new URL(`../../examples/outputs/${fileName}`, import.meta.url), 'utf8')) as TOutput;
}

afterEach(async () => {
	await application?.close();
	application = null;
});

describe('create and process report job example', () => {
	it('dispatches, rehydrates, and handles the service-owned example', async () => {
		const driver = new MemoryQueueDriver();
		const queue = new Queue({} as Database, {
			driver,
		});

		application = new App({
			db: {} as never,
			log: {
				enabled: false,
			},
		});
		application.set('queue', queue);

		registerGenerateReportJob();
		const jobId = await dispatchGenerateReportJob('report_01');
		const result = await processNextReportJob();

		const output = {
			jobId,
			status: result?.status,
			completedJobs: driver.completed.length,
			remainingJobs: driver.jobs.length,
		};

		expect(output).toEqual(readExampleOutput('create-and-process-report-job.json'));
		expect(result).toMatchObject({
			status: 'succeeded',
			job: {
				payload: {
					job: GenerateReportJob.name,
					data: {
						reportId: 'report_01',
					},
				},
			},
		});
		expect(driver.jobs).toHaveLength(0);
		expect(driver.completed).toHaveLength(1);
	});

	it('dispatches ordered pipelines and independent batches', async () => {
		const driver = new MemoryQueueDriver();
		const queue = new Queue({} as Database, {
			driver,
		});

		application = new App({
			db: {} as never,
			log: {
				enabled: false,
			},
		});
		application.set('queue', queue);

		await dispatchReportPipeline(['report_01', 'report_02']);

		const initiallyQueued = driver.jobs.length;

		expect(driver.jobs).toHaveLength(1);
		await queue.workNextJob('reports');
		await queue.workNextJob('reports');
		const completedJobs = driver.completed.length;

		expect(driver.completed).toHaveLength(2);

		const batchIds = await dispatchReportBatch(['report_03', 'report_04']);

		expect(batchIds).toEqual([3, 4]);
		expect(driver.jobs).toHaveLength(2);
		expect(driver.jobs.map(job => job.queue)).toEqual(['reports', 'reports']);
		expect({
			pipeline: {
				initiallyQueued,
				completedJobs,
			},
			batch: {
				jobIds: batchIds,
				queuedJobs: driver.jobs.length,
				queue: driver.jobs[0]?.queue,
			},
		}).toEqual(readExampleOutput('dispatch-report-workflows.json'));
	});

	it('persists retry policy, signals backpressure, and replays a failure', async () => {
		const driver = new MemoryQueueDriver();
		const queue = new Queue({} as Database, {
			driver,
		});

		application = new App({
			db: {} as never,
			log: {
				enabled: false,
			},
		});
		application.set('queue', queue);

		await dispatchReportWithRetryPolicy('report_01');

		expect(driver.jobs[0]).toMatchObject({
			queue: 'reports',
			payload: {
				maxTries: 8,
				backoff: {
					strategy: 'exponential',
					initialSeconds: 15,
					maxSeconds: 900,
					jitter: true,
				},
			},
		});
		let backpressure: { error: string; delaySeconds: number } | null = null;

		try {
			retryReportAfterBackpressure(45);
		} catch (error) {
			backpressure = {
				error: error instanceof Error ? error.name : 'UnknownError',
				delaySeconds: (error as { delaySeconds?: number }).delaySeconds ?? 0,
			};
		}

		expect(backpressure).toEqual({
			error: 'QueueRetryLaterError',
			delaySeconds: 45,
		});

		driver.storedFailures.push({
			id: 'failed_report_01',
			connection: 'memory',
			queue: 'reports',
			payload: {
				uuid: 'failed-report-uuid',
				displayName: GenerateReportJob.name,
				job: GenerateReportJob.name,
				maxTries: 8,
				data: {
					reportId: 'report_02',
				},
			},
			exception: 'Provider unavailable',
			failedAt: '2026-08-10T12:00:00.000Z',
		});

		const replacementId = await retryFailedReportJob('failed_report_01');

		expect(replacementId).toBe(2);
		expect(driver.storedFailures).toHaveLength(1);
		expect(driver.jobs[1]).toMatchObject({
			queue: 'reports',
			payload: {
				retryOf: {
					failedJobId: 'failed_report_01',
					jobUuid: 'failed-report-uuid',
				},
			},
		});
		expect({
			policy: {
				queue: driver.jobs[0]?.queue,
				maxTries: driver.jobs[0]?.payload.maxTries,
				backoff: driver.jobs[0]?.payload.backoff,
			},
			backpressure,
			replay: {
				replacementId,
				failedAuditRecords: driver.storedFailures.length,
				retryOf: driver.jobs[1]?.payload.retryOf,
			},
		}).toEqual(readExampleOutput('manage-report-retries.json'));
	});
});
