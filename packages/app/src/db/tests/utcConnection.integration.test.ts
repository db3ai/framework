import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, destroyDatabase } from '../connection';
import { createGeneratedTestDatabase } from '../test/db';

/** Closes the singleton before restoring its connection environment. */
afterEach(async () => {
	await destroyDatabase();
	vi.unstubAllEnvs();
});

describe('UTC application database connection', () => {
	it('round trips instants independently of process timezone through datetime and timestamp columns', async () => {
		const fixture = await createGeneratedTestDatabase('utc_connection');
		try {
			vi.stubEnv('DB_DATABASE', fixture.databaseName);
			if (process.env.DATABASE_URL) {
				const url = new URL(process.env.DATABASE_URL);
				url.pathname = `/${fixture.databaseName}`;
				vi.stubEnv('DATABASE_URL', url.toString());
			}
			vi.stubEnv('TZ', 'America/Los_Angeles');
			const connection = db();
			await connection.schema.createTable('utc_dates', table => {
				table.dateTime('created_at', { precision: 3 });
				table.timestamp('published_at', { precision: 3 });
			});
			const instant = new Date('2026-10-10T13:00:00.123Z');
			await connection('utc_dates').insert({ created_at: instant, published_at: instant });
			const row = await connection('utc_dates').first();
			expect(row.created_at.toISOString()).toBe(instant.toISOString());
			expect(row.published_at.toISOString()).toBe(instant.toISOString());
			const [rows] = await connection.raw("SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS stored, @@session.time_zone AS zone FROM utc_dates");
			expect(rows[0]).toMatchObject({ stored: '2026-10-10 13:00:00', zone: '+00:00' });
		} finally {
			await destroyDatabase();
			await fixture.destroy();
		}
	});
});
