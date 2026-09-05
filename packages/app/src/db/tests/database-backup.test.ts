import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';

import { Database } from '../Database';

/**
 * Creates a minimal Knex-shaped connection for database service construction.
 *
 * @returns Non-querying Knex test double.
 */
function fakeKnex(): Knex {
	return (() => undefined) as unknown as Knex;
}

describe('Database backup', () => {
	it('reports when the application has not configured a backup handler', async () => {
		const database = new Database(fakeKnex());

		await expect(database.backup({ trigger: 'manual' })).rejects.toThrow(
			'Database backup has not been configured for this application',
		);
	});

	it('delegates backup requests to the application-owned handler', async () => {
		const database = new Database(fakeKnex());
		const request = {
			backupId: '01H00000000000000000000001',
			trigger: 'manual',
		};
		const handler = vi.fn().mockResolvedValue({
			id: request.backupId,
		});

		database.setBackupHandler(handler);

		await expect(database.backup<{ id: string }>(request)).resolves.toEqual({
			id: request.backupId,
		});
		expect(handler).toHaveBeenCalledWith(request);
	});
});
