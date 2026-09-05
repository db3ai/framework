import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ActiveRecord, Database } from '../../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../../db/test/db';
import { DatabaseQueueDriver, FailedJob, type JobEnvelope, type QueueJob, QueuedJob } from '../../index';

describe('DatabaseQueueDriver attempt fencing', () => {
	let generatedDatabase: GeneratedTestDatabase;
	let database: Database;
	let driver: DatabaseQueueDriver;

	beforeAll(async () => {
		generatedDatabase = await createGeneratedTestDatabase('database_queue_fencing');
		database = new Database(generatedDatabase.db, {
			reportSchemaDiff: false,
		});
		driver = new DatabaseQueueDriver(database);

		await database.install(
			QueuedJob,
			FailedJob,
		);
	});

	beforeEach(async () => {
		await ActiveRecord.withDb(generatedDatabase.db, async () => {
			await FailedJob.query().forceDelete();
			await QueuedJob.query().forceDelete();
		});
	});

	afterAll(async () => {
		await generatedDatabase?.destroy();
	});

	it('allows only the current attempt to change durable queue state', async () => {
		await driver.push({
			queue: 'default',
			payload: testPayload(),
			delaySeconds: 0,
			createdAt: unixTimestamp(),
		});

		const firstAttempt = await driver.pop('default', {
			retryAfterSeconds: 90,
		});

		expect(firstAttempt).toMatchObject({
			attempts: 1,
		});
		await expect(driver.release(firstAttempt as QueueJob, 0)).resolves.toBe(true);

		const secondAttempt = await driver.pop('default', {
			retryAfterSeconds: 90,
		});

		expect(secondAttempt).toMatchObject({
			attempts: 2,
		});
		await expect(driver.delete(firstAttempt as QueueJob)).resolves.toBe(false);
		await expect(driver.release(firstAttempt as QueueJob, 0)).resolves.toBe(false);
		await expect(driver.defer(firstAttempt as QueueJob, 0)).resolves.toBe(false);
		await expect(driver.fail(firstAttempt as QueueJob, new Error('Stale failure'))).resolves.toBe(false);
		await expect(driver.failedJobs()).resolves.toHaveLength(0);
		await expect(driver.touch(secondAttempt as QueueJob, 90)).resolves.toBe(true);
		await expect(driver.delete(secondAttempt as QueueJob)).resolves.toBe(true);
		await expect(driver.pop('default', {
			retryAfterSeconds: 90,
		})).resolves.toBeNull();
	});
});

/**
 * Creates a durable payload for database attempt-fencing tests.
 *
 * @returns Queue payload with a unique lifecycle identifier.
 */
function testPayload(): JobEnvelope {
	return {
		uuid: randomUUID(),
		displayName: 'FencedDatabaseJob',
		job: 'FencedDatabaseJob',
		maxTries: 3,
		data: {},
	};
}

/**
 * Returns the current whole-second Unix timestamp.
 *
 * @returns Current Unix timestamp.
 */
function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}
