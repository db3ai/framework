import { randomUUID } from 'node:crypto';
import { ActiveRecord } from '../db';
import { MailDeliveryError, type Mail } from '../mail';
import type { Logger } from '../logging';
import { OperationalAlertRecord } from './OperationalAlertRecord';
import { formatOperationalAlertEmail } from './formatOperationalAlertEmail';

const DISPATCH_KEY = 'operational-alerts:email-dispatch';
const LEASE_MS = 300000;

/** Serializes operator email only, retaining quota cooldown and immutable digest membership in the outbox. */
export class OperationalAlertEmails {
	/** Uses the existing mail and logging services; no generic customer-mail policy is changed. */
	readonly #mail: Mail;
	readonly #log: Logger;
	/** Retains services without exposing mutable dispatch configuration. */
	constructor(mail: Mail, log: Logger) {
		this.#mail = mail;
		this.#log = log;
	}

	/** Sends a bounded batch under one crash-expiring database lease; a refusal pauses all operator email. */
	async deliverDue(limit: number): Promise<void> {
		await this.#ensureDispatch();
		const dispatch = await this.#claimDispatch();
		if (!dispatch) return;
		let retryAt = new Date();
		let failures = 0;
		try {
			for (let index = 0; index < limit; index++) {
				const record = await this.#next();
				if (!record) break;
				// Refresh before each bounded request; a stale owner must not submit another email.
				const renewed = await OperationalAlertRecord.where('id', dispatch.id).where('claim', dispatch.claim).patch({ nextAttemptAt: new Date(Date.now() + LEASE_MS) });
				if (!renewed) break;
				try {
					const delivery = await this.#mail.send({ to: record.email!, subject: `[Operations] ${record.alert.summary}`, ...formatOperationalAlertEmail(record), idempotencyKey: `alert:${record.id}` });
					if (!delivery.accepted.length || delivery.rejected.length) throw new Error('Alert email was not accepted.');
					await this.#acknowledge(record);
					dispatch.attempts = 0;
				} catch (error) {
					failures = dispatch.attempts + 1;
					const quota = error instanceof MailDeliveryError && error.provider === 'resend' && error.status === 429 && error.code === 'daily_quota_exceeded';
					const fallback = quota ? 86400000 : Math.min(3600000, 30000 * 2 ** Math.min(failures, 7));
					retryAt = error instanceof MailDeliveryError && error.retryAt && error.retryAt > new Date() ? error.retryAt : new Date(Date.now() + fallback);
					this.#log.error({ err: error, alertId: record.id, retryAt: retryAt.toISOString(), quota }, 'Operational email paused after provider refusal');
					break;
				}
			}
		} finally {
			await OperationalAlertRecord.where('id', dispatch.id).where('claim', dispatch.claim).patch({ claim: null, nextAttemptAt: retryAt, attempts: failures });
		}
	}

	/** Creates the shared coordinator once, tolerating concurrent initialization through the unique key. */
	async #ensureDispatch(): Promise<void> {
		if (await OperationalAlertRecord.where('key', DISPATCH_KEY).first()) return;
		try {
			await OperationalAlertRecord.create({ key: DISPATCH_KEY, kind: 'email-dispatch', alert: { key: DISPATCH_KEY, summary: 'Operator email coordinator', context: {} }, nextAttemptAt: new Date() }).save();
		} catch (error) {
			if (!await OperationalAlertRecord.where('key', DISPATCH_KEY).first()) throw error;
		}
	}

	/** Locks the shared row before accepting a due cooldown probe or recovering an expired owner. */
	async #claimDispatch(): Promise<OperationalAlertRecord | null> {
		return OperationalAlertRecord.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const row = await OperationalAlertRecord.where('key', DISPATCH_KEY).toKnex().forUpdate().first();
			const record = OperationalAlertRecord.fromDb(row);
			if (record.nextAttemptAt > new Date()) return null;
			record.assign({ claim: randomUUID(), nextAttemptAt: new Date(Date.now() + LEASE_MS) });
			await record.save();
			return record;
		}));
	}

	/** Gives fresh distinct incidents priority; existing immutable digests precede forming another same-cause cohort. */
	async #next(): Promise<OperationalAlertRecord | null> {
		const distinct = await this.#pending().whereNull('emailGroupKey').orderBy('createdAt', 'desc').orderBy('id', 'desc').first();
		if (distinct) return distinct;
		const digest = await OperationalAlertRecord.where('kind', 'email-digest').whereNull('emailSentAt').orderBy('createdAt').first();
		if (digest) return digest;
		const grouped = await this.#pending().whereNotNull('emailGroupKey').orderBy('createdAt', 'desc').orderBy('id', 'desc').first();
		return grouped ? this.#digest(grouped) : null;
	}

	/** Selects unsent incidents without stealing an active incident dispatcher claim. */
	#pending() {
		return OperationalAlertRecord.where('kind', 'incident').whereNull('completedAt').whereNull('emailSentAt').whereNull('emailBatchId').whereNotNull('email').where('nextAttemptAt', '<=', new Date());
	}

	/** Persists a cohort of at most the existing maximum batch size before any external submission. */
	async #digest(first: OperationalAlertRecord): Promise<OperationalAlertRecord | null> {
		return OperationalAlertRecord.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const rows = await this.#pending().where('emailGroupKey', first.emailGroupKey!).where('email', first.email!).orderBy('createdAt').orderBy('id').limit(100).toKnex().forUpdate();
			const members: OperationalAlertRecord[] = rows.map((row: Record<string, unknown>) => OperationalAlertRecord.fromDb(row));
			if (!members.length) return null;
			const sample = members[0];
			const digest = OperationalAlertRecord.create({
				key: `operational-alerts:email-digest:${randomUUID()}`, kind: 'email-digest', email: first.email, memberIds: members.map(member => member.id), nextAttemptAt: new Date(),
				alert: { key: first.emailGroupKey!, summary: `${members.length} related operational failures`, context: { emailGroupKey: first.emailGroupKey!, count: members.length, firstDetectedAt: sample.createdAt.toISOString(), lastDetectedAt: members[members.length - 1].createdAt.toISOString(), incidentIds: members.map(member => member.id).join(', ') }, emailDiagnostics: sample.alert.emailDiagnostics ? `Representative incident ${sample.id}:\n${sample.alert.emailDiagnostics}`.slice(0, 128000) : undefined },
			});
			await digest.save();
			await OperationalAlertRecord.query().whereIn('id', digest.memberIds!).patch({ emailBatchId: digest.id });
			// Reload the stored timestamp precision before first rendering so retries have identical provider content.
			return (await OperationalAlertRecord.where('id', digest.id).first())!;
		}));
	}

	/** Commits provider acceptance and member acknowledgements atomically, leaving webhook state independent. */
	async #acknowledge(record: OperationalAlertRecord): Promise<void> {
		await OperationalAlertRecord.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const acceptedAt = new Date();
			await OperationalAlertRecord.where('id', record.id).patch({ emailSentAt: acceptedAt, ...(record.kind === 'email-digest' ? { completedAt: acceptedAt } : {}) });
			if (record.memberIds?.length) await OperationalAlertRecord.query().whereIn('id', record.memberIds).where('emailBatchId', record.id).patch({ emailSentAt: acceptedAt });
		}));
	}
}
