import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActiveRecord } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

/** Small persisted model for observing real transactional row locks. */
class LockRecord extends ActiveRecord.define({ table: 'lock_records', fields: field => ({ id: field.ulid(), value: field.string() }) }) {}

let database: GeneratedTestDatabase;
let application: App;
beforeAll(async () => {
	database = await createGeneratedTestDatabase('row_locking');
	application = new App({ db: database.db });
	await application.db.install(LockRecord);
});
afterAll(async () => { await application?.close(); await database?.destroy(); });

describe('typed forUpdate row locks', () => {
	it.each(['commit', 'rollback'] as const)('blocks a competing lock and releases on %s', async outcome => {
		const record = await LockRecord.create({ value: 'before' }).save();
		const owner = await database.db.transaction();
		const competitor = await database.db.transaction();
		try {
			const locked: LockRecord | null = await LockRecord.query(owner).where('id', record.id).forUpdate().first();
			expect(locked).toBeInstanceOf(LockRecord);
			locked!.value = 'after';
			await locked!.save();
			// NOWAIT observes an actual conflicting lock without relying on timing or arbitrary sleeps.
			await expect(LockRecord.query(competitor).where('id', record.id).forUpdate().toKnex().noWait().first()).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
			await owner[outcome]();
			const available = await LockRecord.query(competitor).where('id', record.id).forUpdate().first();
			expect(available?.value).toBe(outcome === 'commit' ? 'after' : 'before');
		} finally {
			await owner.rollback();
			await competitor.rollback();
		}
	});

	it('releases locks when the app transaction callback throws', async () => {
		const record = await LockRecord.create({ value: 'before' }).save();
		await expect(application.db.transaction(async () => {
			const locked = await LockRecord.where('id', record.id).forUpdate().firstOrFail();
			locked.value = 'discarded'; await locked.save();
			throw new Error('Cancel this transaction');
		})).rejects.toThrow('Cancel this transaction');
		await application.db.transaction(async () => {
			const available = await LockRecord.where('id', record.id).forUpdate().firstOrFail();
			expect(available.value).toBe('before');
		});
	});
});
