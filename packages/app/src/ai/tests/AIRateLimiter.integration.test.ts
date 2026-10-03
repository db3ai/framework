import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import knex, { type Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRequestError, AIRateLimitDeferredError, AIRateLimiter, AiConversation, AiRateLimitBucket, AiRateLimitReservation, AiRequest, embeddingsRateLimitEndpoint, providerResponseMetadata, type AIRateLimitLease } from '@db3.ai/app/ai';
import { ActiveRecord } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { PinoLoggerDriver } from '@db3.ai/app/logging';

let database: GeneratedTestDatabase;
let application: App;
let observer: Knex;
const logs: string[] = [];
const limiter = new AIRateLimiter();
const provider = vi.fn<typeof globalThis.fetch>();

/** Creates one real lease whose persisted state can be independently inspected. */
async function acquireLease(): Promise<AIRateLimitLease> {
	return limiter.acquire({ endpoint: embeddingsRateLimitEndpoint(), model: 'text-embedding-3-small', operation: 'embeddings.create', estimatedTokens: 10 });
}

/**
 * Waits for an actual InnoDB lock wait instead of inferring contention from time.
 *
 * @param databaseName - Disposable database whose lock graph is being tested.
 * @param outcome - Optional completion state to reject an unexpectedly early release.
 */
async function waitForReservationLock(databaseName: string, outcome?: { done: boolean; error: unknown }): Promise<void> {
	const deadline = Date.now() + 5000;
	let observed = '';
	while (Date.now() < deadline) {
		if (outcome?.done) throw new Error(`Release finished before entering the index lock wait: ${(outcome.error as { code?: string } | null)?.code ?? 'success'}.`);
		const [rows] = await observer.raw('SELECT waiting.lock_index FROM information_schema.INNODB_LOCK_WAITS AS waits JOIN information_schema.INNODB_LOCKS AS waiting ON waiting.lock_id = waits.requested_lock_id WHERE waiting.lock_table = ?', [`\`${databaseName}\`.\`ai_rate_limit_reservations\``]) as [Array<{ lock_index: string }>, unknown];
		observed = rows.map(row => row.lock_index).join(',');
		if (rows.some(row => row.lock_index.includes('released_at'))) return;
		// InnoDB lock metadata is cached briefly; allow it to refresh between reads.
		await delay(150);
	}
	throw new Error(`The release index did not enter a lock wait; last reservation lock index: ${observed}.`);
}

/**
 * Holds one row while shortening only the free test session's lock wait.
 *
 * @param table - Framework table in this disposable database.
 * @param id - Primary key whose write is deliberately blocked.
 * @returns Transaction and session settings that must be restored in finally.
 */
async function holdRow(table: string, id: string): Promise<{ blocker: Knex.Transaction; timeout: number }> {
	const blocker = await database.db.transaction();
	try {
		await blocker(table).where('id', id).forUpdate().first();
		const [rows] = await database.db.raw('SELECT @@session.innodb_lock_wait_timeout AS timeout') as [Array<{ timeout: number }>, unknown];
		await database.db.raw('SET SESSION innodb_lock_wait_timeout = 1');
		return { blocker, timeout: Number(rows[0].timeout) };
	} catch (error) {
		await blocker.rollback();
		throw error;
	}
}

/** Restores both disposable pooled sessions without relying on checkout order. */
async function restoreTimeout(timeout: number): Promise<void> {
	const first = await database.db.transaction();
	let second: Knex.Transaction | null = null;
	try {
		second = await database.db.transaction();
		await first.raw('SET SESSION innodb_lock_wait_timeout = ?', [timeout]);
		await second.raw('SET SESSION innodb_lock_wait_timeout = ?', [timeout]);
	} finally {
		if (second && !second.isCompleted()) await second.rollback();
		if (!first.isCompleted()) await first.rollback();
	}
}

/** Loads the exact provider lease after the real AI service has linked its request. */
async function providerLease(): Promise<AIRateLimitLease> {
	const reservation = await AiRateLimitReservation.query().whereNull('releasedAt').first();
	if (!reservation?.bucket?.id) throw new Error('Provider request has no active reservation.');
	const bucket = await AiRateLimitBucket.findByPk(String(reservation.bucket.id));
	return { bucketKey: String(bucket?.bucketKey), bucket, reservation, endpoint: embeddingsRateLimitEndpoint(), model: 'text-embedding-3-small', operation: 'embeddings.create' };
}

/** Installs a real secondary-index gap lock with a heavier deadlock participant. */
async function holdReleasedIndex(lease: AIRateLimitLease): Promise<Knex.Transaction> {
	const released = [];
	for (let index = 0; index < 20; index++) {
		released.push(await new AiRateLimitReservation({ bucket: lease.bucket, reservedRequests: 1, reservedTokens: 1, expiresAt: new Date(Date.now() + 60000), releasedAt: new Date(Date.now() + 60000) }).save());
	}
	const blocker = await database.db.transaction();
	try {
		// Equality writes keep the optimizer from scanning/locking the active row.
		for (const row of released) await blocker(AiRateLimitReservation.table).where('id', row.id).increment('reserved_tokens', 1);
		const [indices] = await blocker.raw('SHOW INDEX FROM ??', [AiRateLimitReservation.table]) as [Array<{ Key_name: string; Column_name: string }>, unknown];
		const releaseIndex = indices.find(index => index.Column_name === 'released_at')?.Key_name;
		if (!releaseIndex) throw new Error('Missing reservation release index.');
		await blocker.raw('SELECT id FROM ?? FORCE INDEX (??) WHERE released_at >= ? FOR UPDATE', [AiRateLimitReservation.table, releaseIndex, new Date(Date.now() + 30000)]);
		return blocker;
	} catch (error) {
		await blocker.rollback();
		throw error;
	}
}

/** Completes the observed lock cycle and frees the surviving transaction for retry. */
async function finishDeadlock(blocker: Knex.Transaction, lease: AIRateLimitLease, outcome?: { done: boolean; error: unknown }): Promise<void> {
	try {
		await waitForReservationLock(database.databaseName, outcome);
		await blocker(AiRateLimitReservation.table).where('id', lease.reservation?.id).forUpdate().first();
	} finally {
		if (!blocker.isCompleted()) await blocker.rollback();
	}
}

beforeAll(async () => {
	database = await createGeneratedTestDatabase('ai_release_locks');
	observer = knex({ ...database.db.client.config, pool: { min: 0, max: 1 } });
	const destination = new Writable({
		/** Captures real structured logging without mocking framework components. */
		write(chunk, _encoding, callback) { logs.push(String(chunk)); callback(); },
	});
	application = new App({ ai: { apiKey: 'synthetic-test-key', fetch: provider }, db: database.db, dbOptions: { reportSchemaDiff: false }, log: { driver: new PinoLoggerDriver({ level: 'warn', environment: 'test' }, destination) } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiRateLimitReservation);
});

beforeEach(async () => {
	logs.length = 0;
	provider.mockReset();
	await AiRateLimitReservation.query().delete();
	await AiRequest.query().delete();
	await AiRateLimitBucket.query().delete();
});

afterAll(async () => {
	try { await application?.close(); } finally {
		await observer?.destroy();
		await database?.destroy();
	}
});

describe('AIRateLimiter real MariaDB release contention', () => {
	it('keeps failed release state retryable and emits only safe diagnostics', async () => {
		const lease = await acquireLease();
		const { blocker, timeout } = await holdRow(AiRateLimitReservation.table, String(lease.reservation?.id));
		try {
			const failure = await limiter.release(lease).then(() => null, error => error);
			expect.soft(failure).toBeNull();
			expect.soft(lease.reservation?.releasedAt).toBeNull();
			const [persisted] = await blocker(AiRateLimitReservation.table).where('id', lease.reservation?.id).select('released_at');
			expect(persisted.released_at).toBeNull();
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 3, recovered: false, reservationId: lease.reservation?.id }));
			expect(logs.join('')).not.toMatch(/update |bindings|sqlMessage|stack/);
		} finally {
			try { await blocker.rollback(); } finally { await restoreTimeout(timeout); }
		}
		await limiter.release(lease);
		await limiter.release(lease);
		expect(lease.reservation?.releasedAt).toBeInstanceOf(Date);
		expect(await AiRateLimitReservation.findByPk(String(lease.reservation?.id))).toBeNull();
		const next = await acquireLease();
		await limiter.release(next);
	}, 15000);

	it('recovers a real secondary-index release deadlock', async () => {
		const lease = await acquireLease();
		const blocker = await holdReleasedIndex(lease);
		const releasing = limiter.release(lease).then(() => null, error => error);
		try {
			await finishDeadlock(blocker, lease);
			expect(await releasing).toBeNull();
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: 'ER_LOCK_DEADLOCK', attempts: 2, recovered: true }));
			expect(await AiRateLimitReservation.findByPk(String(lease.reservation?.id))).toBeNull();
		} finally {
			if (!blocker.isCompleted()) await blocker.rollback();
			await releasing;
		}
	}, 15000);

	it.each(['success', 'rejection', 'rate-limit', 'transport'] as const)('preserves the provider %s outcome after release retries are exhausted', async outcome => {
		const state: { held: Awaited<ReturnType<typeof holdRow>> | null } = { held: null };
		provider.mockImplementationOnce(async () => {
			const lease = await providerLease();
			state.held = await holdRow(AiRateLimitReservation.table, String(lease.reservation?.id));
			if (outcome === 'transport') throw new Error('Synthetic transport failure');
			if (outcome === 'rejection') return Response.json({ error: { message: 'Synthetic provider rejection', code: 'invalid_input' } }, { status: 400 });
			if (outcome === 'rate-limit') return Response.json({ error: { message: 'Capacity exhausted', code: 'rate_limit_exceeded' } }, { status: 429 });
			return Response.json({ data: [{ embedding: [0.3, 0.4] }], usage: { prompt_tokens: 10, total_tokens: 10 } });
		});
		try {
			const result = await application.ai.generateEmbedding('PRIVATE customer passage').then(value => value, error => error);
			expect(provider).toHaveBeenCalledTimes(1);
			const request = await AiRequest.query().first();
			if (outcome === 'success') {
				expect(result.vector).toEqual([0.3, 0.4]);
				expect(request).toMatchObject({ status: 'completed', inputTokens: 10, totalTokens: 10 });
				expect(request?.costUSD).toBeGreaterThan(0);
			} else if (outcome === 'rate-limit') {
				expect(result).toBeInstanceOf(AIRateLimitDeferredError);
				expect(request?.status).toBe('failed');
			} else {
				expect(result).toBeInstanceOf(AIRequestError);
				expect(result.message).toBe(outcome === 'transport' ? 'Synthetic transport failure' : 'Synthetic provider rejection');
				expect(result.code).toBe(outcome === 'transport' ? null : 'invalid_input');
				expect(request?.status).toBe('failed');
			}
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 3, recovered: false }));
			expect(logs.join('')).not.toMatch(/PRIVATE|sqlMessage|bindings|stack/);
			expect((await AiRateLimitReservation.query().first())?.releasedAt).toBeNull();
		} finally {
			if (state.held) {
				try { await state.held.blocker.rollback(); } finally { await restoreTimeout(state.held.timeout); }
			}
		}
	}, 15000);

	it('keeps bucket observation failure best effort and still releases the reservation', async () => {
		const lease = await acquireLease();
		const { blocker, timeout } = await holdRow(AiRateLimitBucket.table, String(lease.bucket?.id));
		try {
			await expect(limiter.observe(lease, providerResponseMetadata(new Headers({ 'x-request-id': 'req_observe', 'x-ratelimit-remaining-requests': '5' })))).resolves.toBeUndefined();
			const [persisted] = await blocker(AiRateLimitBucket.table).where('id', lease.bucket?.id).select('remaining_requests');
			expect(persisted.remaining_requests).toBeNull();
			expect(await AiRateLimitReservation.query().count()).toBe(0);
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'bucket:observe', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 3, recovered: false }));
		} finally {
			try { await blocker.rollback(); } finally { await restoreTimeout(timeout); }
		}
	}, 15000);

	it('preserves a durable release when concurrent global cleanup cannot finish', async () => {
		const lease = await acquireLease();
		const expired = await new AiRateLimitReservation({ bucket: lease.bucket, reservedRequests: 1, expiresAt: new Date(Date.now() - 1000) }).save();
		const { blocker, timeout } = await holdRow(AiRateLimitReservation.table, String(expired.id));
		try {
			await expect(limiter.release(lease)).resolves.toBeUndefined();
			expect((await AiRateLimitReservation.findByPk(String(lease.reservation?.id)))?.releasedAt).toBeInstanceOf(Date);
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:cleanup', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 1, recovered: false }));
		} finally {
			try { await blocker.rollback(); } finally { await restoreTimeout(timeout); }
		}
		await AiRateLimitReservation.cleanupReleasedAndExpired();
		expect(await AiRateLimitReservation.query().count()).toBe(0);
	}, 15000);

	it('does not retry a persistence failure inside an ambient transaction', async () => {
		const lease = await acquireLease();
		const { blocker, timeout } = await holdRow(AiRateLimitReservation.table, String(lease.reservation?.id));
		let transaction: Knex.Transaction | null = null;
		try {
			transaction = await database.db.transaction();
			await expect(ActiveRecord.withDb(transaction, () => limiter.release(lease))).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 1, recovered: false }));
			expect(lease.reservation?.releasedAt).toBeNull();
		} finally {
			if (transaction && !transaction.isCompleted()) await transaction.rollback();
			try { await blocker.rollback(); } finally { await restoreTimeout(timeout); }
		}
	}, 15000);

	it('propagates ambient cleanup failure and leaves rollback to its owner', async () => {
		const lease = await acquireLease();
		const expired = await new AiRateLimitReservation({ bucket: lease.bucket, reservedRequests: 1, expiresAt: new Date(Date.now() - 1000) }).save();
		const { blocker, timeout } = await holdRow(AiRateLimitReservation.table, String(expired.id));
		let transaction: Knex.Transaction | null = null;
		try {
			transaction = await database.db.transaction();
			await expect(ActiveRecord.withDb(transaction, () => limiter.release(lease))).rejects.toMatchObject({ code: 'ER_LOCK_WAIT_TIMEOUT' });
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:cleanup', code: 'ER_LOCK_WAIT_TIMEOUT', attempts: 1, recovered: false, transactionFailed: true }));
		} finally {
			if (transaction && !transaction.isCompleted()) await transaction.rollback();
			try { await blocker.rollback(); } finally { await restoreTimeout(timeout); }
		}
		// The conditional update must tolerate a lease whose in-memory date came from a rolled-back write.
		expect((await AiRateLimitReservation.findByPk(String(lease.reservation?.id)))?.releasedAt).toBeNull();
		await limiter.release(lease);
		expect(await AiRateLimitReservation.findByPk(String(lease.reservation?.id))).toBeNull();
	}, 15000);

	it('reports a real ambient deadlock and prevents writes after the caller transaction is rolled back', async () => {
		const lease = await acquireLease();
		const blocker = await holdReleasedIndex(lease);
		let transaction: Knex.Transaction | null = null;
		let releasing: Promise<unknown> | null = null;
		try {
			transaction = await database.db.transaction();
			const owned = await ActiveRecord.withDb(transaction, () => AiRequest.create({ request: { purpose: 'caller-owned transaction write' } }).save());
			expect(await transaction(AiRequest.table).where('id', owned.id).first()).toBeDefined();
			const outcome = { done: false, error: null as unknown };
			releasing = ActiveRecord.withDb(transaction, () => limiter.release(lease)).then(() => { outcome.done = true; return null; }, error => { outcome.done = true; outcome.error = error; return error; });
			await finishDeadlock(blocker, lease, outcome);
			const failure = await releasing;
			expect.soft(failure).toMatchObject({ code: 'ER_LOCK_DEADLOCK' });
			// InnoDB has discarded the caller's earlier write, even though Knex remains usable.
			expect(await transaction(AiRequest.table).where('id', owned.id).first()).toBeUndefined();
			expect(lease.reservation?.releasedAt).toBeNull();
			const queries: string[] = [];
			/** Detects attempted follow-up writes without retaining customer query bindings. */
			function recordQuery(query: { sql: string }): void { queries.push(query.sql); }
			transaction.on('query', recordQuery);
			try {
				await expect(ActiveRecord.withDb(transaction, () => limiter.release(lease))).rejects.toBe(failure);
				expect(queries).toHaveLength(0);
			} finally {
				transaction.off('query', recordQuery);
			}
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: 'ER_LOCK_DEADLOCK', attempts: 1, recovered: false }));
		} finally {
			if (transaction && !transaction.isCompleted()) await transaction.rollback();
			if (!blocker.isCompleted()) await blocker.rollback();
			await releasing;
		}
	}, 15000);

	it('does not retry unrecognized SQL failures or leak their SQL message', async () => {
		const lease = await acquireLease();
		const offlineTable = 'ai_rate_limit_reservations_offline';
		await database.db.schema.renameTable(AiRateLimitReservation.table, offlineTable);
		try {
			await expect(limiter.release(lease)).resolves.toBeUndefined();
			expect(lease.reservation?.releasedAt).toBeNull();
			expect(logs.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'reservation:release', code: null, attempts: 1, recovered: false }));
			expect(logs.join('')).not.toMatch(/doesn't exist|update |bindings|sqlMessage|stack/);
		} finally {
			await database.db.schema.renameTable(offlineTable, AiRateLimitReservation.table);
		}
		await limiter.release(lease);
	});
});
