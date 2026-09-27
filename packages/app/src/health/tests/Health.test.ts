import { describe, expect, it } from 'vitest';
import type { Database } from '@db3.ai/app/db';
import { databaseHealthCheck, Health } from '@db3.ai/app/health';

describe('Health', () => {
	it('returns a useful report without application configuration', async () => {
		const report = await new Health({ service: 'notes-api' }).report();

		expect(report).toMatchObject({
			status: 'ok',
			service: 'notes-api',
			checks: {
				application: { status: 'ok' },
			},
		});
		expect(report.timestamp).toEqual(expect.any(String));
		expect(report.checks.application.durationMs).toEqual(expect.any(Number));
	});

	it('aggregates extensions and contains thrown check details', async () => {
		const health = new Health({
			checks: {
				optional: () => ({ status: 'degraded', message: 'Optional provider unavailable.' }),
			},
		});
		health.register('database', async () => {
			throw new Error('private database address');
		});

		await expect(health.report()).resolves.toMatchObject({
			status: 'unhealthy',
			checks: {
				optional: { status: 'degraded', message: 'Optional provider unavailable.' },
				database: { status: 'unhealthy', message: 'Health check failed.' },
			},
		});
	});

	it('replaces stable names and removes only application checks', async () => {
		const health = new Health();
		health.register('dependency', () => ({ status: 'unhealthy' }));
		health.register('dependency', () => ({ status: 'ok' }));

		expect(health.remove('application')).toBe(false);
		expect(health.remove('dependency')).toBe(true);
		expect(await health.report()).toMatchObject({
			status: 'ok',
			checks: { application: { status: 'ok' } },
		});
	});

	it('marks a component unhealthy when its bounded check does not settle', async () => {
		const health = new Health({ timeoutMs: 5 });
		health.register('stuck', () => new Promise(() => undefined));

		await expect(health.report()).resolves.toMatchObject({
			status: 'unhealthy',
			checks: {
				stuck: { status: 'unhealthy', message: 'Health check failed.' },
			},
		});
	});

	it('provides the standard non-mutating database check', async () => {
		let query = '';
		const check = databaseHealthCheck({
			knex: {
				raw: async (sql: string) => {
					query = sql;
				},
			},
		} as unknown as Database);

		await expect(check()).resolves.toEqual({ status: 'ok' });
		expect(query).toBe('SELECT 1');
	});
});
