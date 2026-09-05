import { Writable } from 'node:stream';
import type { Knex } from 'knex';
import pino from 'pino';
import {
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import { App } from '../../server';
import {
	Log,
	PinoLoggerDriver,
	type LoggerDriver,
} from '..';

describe('Log', () => {
	it('writes structured records with source and child context', async () => {
		const records: string[] = [];
		const driver = new PinoLoggerDriver({
			console: false,
			devtools: false,
			environment: 'test',
			level: 'debug',
			source: 'test-app',
		}, captureDestination(records));
		const log = new Log({
			driver,
		});

		log.child({
			requestId: 'request-1',
		}).info({
			answer: 42,
		}, 'Request completed');

		await log.flush();

		expect(JSON.parse(records.join('').trim())).toMatchObject({
			source: 'test-app',
			environment: 'test',
			requestId: 'request-1',
			answer: 42,
			msg: 'Request completed',
			level: 30,
		});
	});

	it('serializes errors and removes sensitive default fields', async () => {
		const records: string[] = [];
		const log = new Log({
			driver: new PinoLoggerDriver({
				console: false,
				devtools: false,
				environment: 'test',
				level: 'info',
			}, captureDestination(records)),
		});

		log.error({
			err: new Error('Database unavailable'),
			password: 'not-for-logs',
			headers: {
				authorization: 'Bearer secret',
			},
		}, 'Request failed');

		await log.flush();

		const record = JSON.parse(records.join('').trim());

		expect(record.password).toBeUndefined();
		expect(record.headers).toEqual({});
		expect(record.err).toMatchObject({
			message: 'Database unavailable',
			type: 'Error',
		});
		expect(record.err.stack).toContain('Database unavailable');
	});

	it('closes an injected driver through the application lifecycle', async () => {
		const flush = vi.fn(async () => {});
		const close = vi.fn(async () => {});
		const driver = {
			logger: pino({
				level: 'silent',
			}),
			flush,
			close,
		} satisfies LoggerDriver;
		const application = new App({
			db: {} as Knex,
			log: {
				driver,
			},
		});

		expect(application.log).toBe(application.log);

		await application.close();

		expect(close).toHaveBeenCalledTimes(1);
		expect(flush).not.toHaveBeenCalled();
	});

	it('starts and drains the devtools worker when its endpoint is unavailable', async () => {
		const log = new Log({
			console: false,
			devtools: {
				url: 'http://127.0.0.1:1/api/events',
				requestTimeoutMs: 25,
			},
			environment: 'development',
			source: 'worker-test',
		});

		log.info({
			test: true,
		}, 'Worker transport test');

		await expect(log.close()).resolves.toBeUndefined();
	});
});

/**
 * Creates a writable destination that retains complete Pino JSON lines.
 *
 * @param records - Mutable string collection receiving written chunks.
 * @returns Destination accepted by the Pino driver.
 */
function captureDestination(records: string[]): Writable {
	return new Writable({
		write(chunk, _encoding, callback) {
			records.push(chunk.toString());
			callback();
		},
	});
}
