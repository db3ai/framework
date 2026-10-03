import { createHmac, randomUUID } from 'node:crypto';
import { ActiveRecord } from '../db';
import type { Logger } from '../logging';
import type { Mail } from '../mail';
import type { OperationalAlert, OperationalAlertDestinations } from './contracts';
import { OperationalAlertEmails } from './OperationalAlertEmails';
import { OperationalAlertRecord } from './OperationalAlertRecord';

/** Durable, at-least-once operator email/webhook delivery independent of application queue workers. */
export class OperationalAlerts {
	readonly #destinations: OperationalAlertDestinations;
	readonly #mail: Mail;
	readonly #log: Logger;
	/** Creates an outbox with explicit destinations and existing framework mail/log services. */
	constructor(
		destinations: OperationalAlertDestinations,
		mail: Mail,
		log: Logger,
	) {
		this.#destinations = { ...destinations };
		this.#mail = mail;
		this.#log = log;
		if (destinations.webhookUrl) {
			const url = new URL(destinations.webhookUrl);
			if (url.protocol !== 'https:' || url.username || url.password || !destinations.webhookSecret) {
				throw new Error('Operational webhooks require HTTPS, no URL credentials and a signing secret.');
			}
		}
	}

	/** Records an incident once; callers log the raw error separately using the same key. */
	async record(alert: OperationalAlert): Promise<void> {
		if (alert.key?.startsWith('operational-alerts:') || !alert.key || alert.key.length > 255 || !alert.summary || alert.summary.length > 500) {
			throw new Error('Operational alerts require a bounded key and summary.');
		}
		if (alert.emailDiagnostics !== undefined && (typeof alert.emailDiagnostics !== 'string' || alert.emailDiagnostics.length > 128000)) {
			throw new Error('Email diagnostics must be text of at most 128,000 characters.');
		}
		if (alert.emailGroupKey !== undefined && (typeof alert.emailGroupKey !== 'string' || !alert.emailGroupKey || alert.emailGroupKey.length > 255)) throw new Error('Email group keys must contain 1–255 characters.');
		const existing = await OperationalAlertRecord.where('key', alert.key).first();
		if (existing) return;
		try {
			await OperationalAlertRecord.create({
				key: alert.key,
				alert,
				emailGroupKey: alert.emailGroupKey ?? null,
				email: this.#destinations.email ?? null,
				webhookUrl: this.#destinations.webhookUrl ?? null,
				nextAttemptAt: new Date(),
			}).save();
		} catch (error) {
			// A concurrent recorder may have won the unique incident key.
			if (!await OperationalAlertRecord.where('key', alert.key).first()) throw error;
		}
	}

	/** Delivers a bounded batch with channel acknowledgements, expiring claims and exponential retry. */
	async deliverDue(limit = 20): Promise<number> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Alert batch limit must be 1–100.');
		await new OperationalAlertEmails(this.#mail, this.#log).deliverDue(limit);
		// An active email owner must finish its selection before another dispatcher claims those incidents.
		const dispatch = await OperationalAlertRecord.where('kind', 'email-dispatch').first();
		if (dispatch?.claim && dispatch.nextAttemptAt > new Date()) return 0;
		const candidates = await OperationalAlertRecord.where('kind', 'incident').whereNull('completedAt')
			.where('nextAttemptAt', '<=', new Date()).orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(limit).all();
		let delivered = 0;
		for (const candidate of candidates) {
			const record = await this.#claim(candidate.id);
			if (!record) continue;
			const body = JSON.stringify({ id: record.id, createdAt: record.createdAt.toISOString(), key: record.alert.key, summary: record.alert.summary, context: record.alert.context });
			let failed = false;
			for (const channel of ['email', 'webhook'] as const) {
				try {
					if (channel === 'email' && record.email && !record.emailSentAt) failed = true;
					if (channel === 'webhook' && record.webhookUrl && !record.webhookSentAt) {
						if (record.webhookUrl !== this.#destinations.webhookUrl || !this.#destinations.webhookSecret) throw new Error('Pending alert webhook configuration changed.');
						const timestamp = String(Math.floor(Date.now() / 1000));
						const signature = createHmac('sha256', this.#destinations.webhookSecret).update(`${timestamp}.${body}`).digest('hex');
						const response = await fetch(record.webhookUrl, {
							method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
							headers: { 'content-type': 'application/json', 'idempotency-key': record.id, 'x-alert-timestamp': timestamp, 'x-alert-signature': signature },
							body,
						});
						await response.body?.cancel();
						if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}.`);
						record.webhookSentAt = new Date();
						await OperationalAlertRecord.where('id', record.id).where('claim', record.claim).patch({ webhookSentAt: record.webhookSentAt });
					}
				} catch (error) {
					failed = true;
					this.#log.error({ err: error, incidentKey: record.key, alertId: record.id, channel }, 'Operational alert delivery failed');
				}
			}
			await OperationalAlertRecord.where('id', record.id).where('claim', record.claim).patch({
				claim: null,
				completedAt: failed ? null : new Date(),
				nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(record.attempts, 7))),
			});
			if (!failed) delivered++;
		}
		return delivered;
	}

	/** Claims a due record under a row lock; a crashed dispatcher becomes eligible after five minutes. */
	async #claim(id: string): Promise<OperationalAlertRecord | null> {
		return OperationalAlertRecord.getDb().transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			const row = await OperationalAlertRecord.where('id', id).toKnex().forUpdate().first();
			if (!row) return null;
			const record = OperationalAlertRecord.fromDb(row);
			if (record.completedAt || record.nextAttemptAt > new Date()) return null;
			if (!record.email && !record.webhookUrl) {
				record.email = this.#destinations.email ?? null;
				record.webhookUrl = this.#destinations.webhookUrl ?? null;
				if (!record.email && !record.webhookUrl) return null;
			}
			record.assign({ claim: randomUUID(), attempts: record.attempts + 1, nextAttemptAt: new Date(Date.now() + 300000) });
			await record.save();
			return record;
		}));
	}
}
