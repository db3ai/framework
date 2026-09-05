import { describe, expect, it, vi } from 'vitest';

import {
	parseSchedulerConsoleArgs,
	runSchedulerConsole,
	type SchedulerConsoleApp,
	type SchedulerRunResult,
} from '..';

/**
 * Creates one empty successful scheduler result for console tests.
 *
 * @returns Successful result for the current UTC minute.
 */
function successfulResult(): SchedulerRunResult {
	const evaluatedFor = new Date('2026-07-23T12:00:00.000Z');

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

describe('scheduler console', () => {
	it('parses positional arguments and long options', () => {
		expect(parseSchedulerConsoleArgs([
			'scheduler:history',
			'latest',
			'--limit=10',
			'--status',
			'failed',
		])).toEqual({
			command: 'scheduler:history',
			args: ['latest'],
			options: {
				limit: '10',
				status: 'failed',
			},
		});
	});

	it('lists registered application schedule definitions and closes the app', async () => {
		const bootstrap = vi.fn(async () => {});
		const close = vi.fn(async () => {});
		const definitions = vi.fn(() => [{
			name: 'DatabaseBackupJob',
			kind: 'job' as const,
			jobName: 'DatabaseBackupJob',
			frequency: {
				type: 'daily' as const,
				time: '02:00',
			},
			timezone: 'Europe/London',
		}]);
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const app = {
			scheduler: {
				definitions,
			},
			close,
		} as unknown as SchedulerConsoleApp;

		try {
			await runSchedulerConsole({
				app: () => app,
				bootstrap,
			}, ['scheduler:list']);

			expect(bootstrap).toHaveBeenCalledOnce();
			expect(definitions).toHaveBeenCalledOnce();
			expect(log).toHaveBeenCalledWith(
				'DatabaseBackupJob\tjob\tdaily at 02:00\tEurope/London\tDatabaseBackupJob',
			);
			expect(close).toHaveBeenCalledOnce();
		} finally {
			log.mockRestore();
		}
	});

	it('runs one due-minute evaluation through the same scheduler service', async () => {
		const close = vi.fn(async () => {});
		const runDue = vi.fn(async () => successfulResult());
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const app = {
			scheduler: {
				runDue,
			},
			close,
		} as unknown as SchedulerConsoleApp;

		try {
			await runSchedulerConsole({
				app: () => app,
			}, ['scheduler:run']);

			expect(runDue).toHaveBeenCalledOnce();
			expect(close).toHaveBeenCalledOnce();
		} finally {
			log.mockRestore();
		}
	});

	it('returns a failure for an unknown command without bootstrapping', async () => {
		const bootstrap = vi.fn(async () => {});

		await expect(runSchedulerConsole({
			app: () => {
				throw new Error('App should not be resolved.');
			},
			bootstrap,
		}, ['scheduler:unknown'])).rejects.toThrow(
			'Unknown scheduler command "scheduler:unknown"',
		);
		expect(bootstrap).not.toHaveBeenCalled();
	});
});
