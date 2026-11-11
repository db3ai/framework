import { randomUUID } from 'node:crypto';
import { ActiveRecord } from '../db';
import type {
	BillingAccountStatus,
	BillingAccountSummary,
	BillingConfig,
	BillingPeriod,
	BillingProvider,
	BillingProviderEvent,
	BillingService,
	BillingSpendCheck,
	BillingUsageSpan,
	BillingUse,
} from './contracts';
import { BillingCreditsExhaustedError, BillingNotSetUpError } from './BillingErrors';
import { BillingAccount, BillingCharge, BillingCreditEntry, BillingEventRecord, BillingUsageRecord, BillingUseRecord } from './models';
import { usageInvoiceLines } from './usageInvoiceLines';

const DAY = 86_400_000;

export interface BillingOptions {
	readonly config: BillingConfig;
	/** Payment provider adapter, for example `stripeBillingProvider()` from `@db3.ai/billing-stripe`. */
	readonly provider?: BillingProvider;
	/** Clock for tests. */
	readonly now?: () => Date;
}

/**
 * Usage-based billing per owner: saved card, usage spans and counted uses,
 * prepaid credit buckets, one invoice a month and a spend limit.
 *
 * Provider calls always happen outside database transactions, keyed so a retry
 * after a crash reaches the same provider object. Webhooks bring the result back.
 */
export class Billing implements BillingService {
	readonly config: BillingConfig;
	readonly #provider: BillingProvider | undefined;
	readonly #now: () => Date;
	readonly #waiters = new Map<string, Set<() => void>>();

	constructor(options: BillingOptions) {
		this.config = options.config;
		this.#provider = options.provider;
		this.#now = options.now ?? (() => new Date());
	}

	async summary(ownerId: string): Promise<BillingAccountSummary> {
		const account = await BillingAccount.where('ownerId', ownerId).first();
		const credits: Record<string, number> = {};
		for (const bucket of Object.keys(this.config.credits)) credits[bucket] = account ? await this.#balance(account.id, bucket) : 0;
		if (!account) return { ownerId, status: 'none', card: null, monthToDate: 0, spendLimit: this.config.newAccountSpendLimit, graceEndsAt: null, credits };
		const now = this.#now();
		return {
			ownerId,
			status: this.#status(account),
			card: account.cardLast4 ? { brand: account.cardBrand ?? '', last4: account.cardLast4, expMonth: account.cardExpMonth ?? 0, expYear: account.cardExpYear ?? 0 } : null,
			monthToDate: await this.#total(account, { start: monthStart(now), end: now }),
			spendLimit: this.#spendLimit(account),
			graceEndsAt: this.#graceEndsAt(account),
			credits,
		};
	}

	async hasBilling(ownerId: string): Promise<boolean> {
		const account = await BillingAccount.where('ownerId', ownerId).first();
		if (!account?.cardLast4) return false;
		const status = this.#status(account);
		return status === 'active' || status === 'past_due';
	}

	async waitForBilling(ownerId: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<boolean> {
		if (await this.hasBilling(ownerId)) return true;
		await new Promise<void>((resolve) => {
			const waiters = this.#waiters.get(ownerId) ?? new Set();
			this.#waiters.set(ownerId, waiters);
			const done = () => {
				clearTimeout(timer);
				options.signal?.removeEventListener('abort', done);
				waiters.delete(done);
				if (waiters.size === 0) this.#waiters.delete(ownerId);
				resolve();
			};
			const timer = setTimeout(done, options.timeoutMs ?? 60_000);
			options.signal?.addEventListener('abort', done, { once: true });
			waiters.add(done);
		});
		return this.hasBilling(ownerId);
	}

	async cardSetupUrl(input: { ownerId: string; name: string; email: string; returnUrl: string }): Promise<string> {
		const provider = this.#requireProvider(input.ownerId);
		const account = await this.#customer(input.ownerId, input.name, input.email);
		const { url } = await provider.cardSetupUrl({ customerId: account.providerCustomerId!, returnUrl: input.returnUrl, idempotencyKey: `card-setup:${account.id}:${randomUUID()}` });
		return url;
	}

	async portalUrl(input: { ownerId: string; returnUrl: string }): Promise<string> {
		const provider = this.#requireProvider(input.ownerId);
		const account = await BillingAccount.where('ownerId', input.ownerId).first();
		if (!account?.providerCustomerId) throw new BillingNotSetUpError(input.ownerId);
		return (await provider.portalUrl({ customerId: account.providerCustomerId, returnUrl: input.returnUrl })).url;
	}

	async checkSpend(ownerId: string, monthly: number): Promise<BillingSpendCheck> {
		const account = await BillingAccount.where('ownerId', ownerId).first();
		const spendLimit = account ? this.#spendLimit(account) : this.config.newAccountSpendLimit;
		const now = this.#now();
		const monthToDate = account ? await this.#total(account, { start: monthStart(now), end: now }) : 0;
		const projected = (account ? await this.#total(account, { start: monthStart(now), end: nextMonth(now) }) : 0) + monthly;
		const result = { monthToDate, projected, spendLimit };
		if (!account?.cardLast4) return { allowed: false, reason: 'no_card', ...result };
		if (this.#status(account) === 'suspended') return { allowed: false, reason: 'suspended', ...result };
		if (spendLimit !== null && projected > spendLimit) return { allowed: false, reason: 'spend_limit', ...result };
		return { allowed: true, ...result };
	}

	async startUsage(input: { ownerId: string; resourceId: string; price: string; at?: Date }): Promise<void> {
		const price = this.config.prices[input.price];
		if (!price || price.per === 'use') throw new Error(`Billing price ${input.price} must be a month or day price in db3/billing.json.`);
		const at = input.at ?? this.#now();
		const account = await this.#account(input.ownerId);
		// Ending the running span and starting the next must land together, or a crash
		// between them stops billing the resource; the account lock stops two starts
		// for one resource both leaving an open span.
		await this.#locked(account.id, async () => {
			const open = await BillingUsageRecord.where('accountId', account.id).where('resourceId', input.resourceId).whereNull('endedAt').first();
			if (open?.price === input.price) return;
			if (open) {
				open.endedAt = at;
				await open.save();
			}
			await BillingUsageRecord.create({ accountId: account.id, resourceId: input.resourceId, price: input.price, startedAt: at, endedAt: null }).save();
		});
	}

	async stopUsage(input: { ownerId: string; resourceId: string; at?: Date }): Promise<void> {
		const account = await BillingAccount.where('ownerId', input.ownerId).first();
		if (!account) return;
		await BillingUsageRecord.where('accountId', account.id).where('resourceId', input.resourceId).whereNull('endedAt').patch({ endedAt: input.at ?? this.#now() });
	}

	async recordUse(input: { ownerId: string; key: string; price: string; quantity?: number; at?: Date }): Promise<void> {
		if (this.config.prices[input.price]?.per !== 'use') throw new Error(`Billing price ${input.price} must be a use price in db3/billing.json.`);
		const account = await this.#account(input.ownerId);
		if (await BillingUseRecord.where('key', input.key).first()) return;
		try {
			await BillingUseRecord.create({ accountId: account.id, key: input.key, price: input.price, quantity: input.quantity ?? 1, at: input.at ?? this.#now() }).save();
		} catch (error) {
			if (!(await BillingUseRecord.where('key', input.key).first())) throw error;
		}
	}

	async creditBalance(ownerId: string, bucket: string): Promise<number> {
		this.#bucket(bucket);
		const account = await BillingAccount.where('ownerId', ownerId).first();
		return account ? this.#balance(account.id, bucket) : 0;
	}

	async spendCredits(input: { ownerId: string; bucket: string; amount: number; key: string }): Promise<{ balance: number }> {
		const config = this.#bucket(input.bucket);
		if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Credit spend must be a whole number above 0.');
		const account = await this.#account(input.ownerId);
		// The balance check and the spend must not interleave with another spend,
		// or two concurrent spends could both pass on the same remaining credits.
		const outcome = await this.#locked(account.id, async () => {
			const balance = await this.#balance(account.id, input.bucket);
			if (await BillingCreditEntry.where('key', `spend:${input.key}`).first()) return { spent: true, balance };
			if (balance < input.amount) return { spent: false, balance };
			await BillingCreditEntry.create({ accountId: account.id, bucket: input.bucket, amount: -input.amount, key: `spend:${input.key}` }).save();
			return { spent: true, balance: balance - input.amount };
		});
		const pack = account.autoTopUp?.[input.bucket];
		const below = config.autoTopUp?.below ?? 0;
		let topUpStarted = false;
		if (pack && outcome.balance < below) topUpStarted = await this.#autoTopUp(account, input.bucket, pack);
		if (!outcome.spent) throw new BillingCreditsExhaustedError(input.ownerId, input.bucket, outcome.balance, topUpStarted);
		return { balance: outcome.balance };
	}

	async buyCredits(input: { ownerId: string; bucket: string; pack: string; ipAddress?: string }) {
		const pack = this.#bucket(input.bucket).packs[input.pack];
		if (!pack) throw new Error(`Credit pack ${input.pack} is not in db3/billing.json credits.${input.bucket}.`);
		const account = await BillingAccount.where('ownerId', input.ownerId).first();
		if (!account?.cardLast4 || !account.providerCustomerId) throw new BillingNotSetUpError(input.ownerId);
		if (this.#status(account) === 'suspended') throw new BillingNotSetUpError(input.ownerId, `Billing is suspended for ${input.ownerId}.`);
		const charge = BillingCharge.create({
			accountId: account.id, kind: 'credits', idempotencyKey: `credits:${randomUUID()}`, state: 'pending',
			amount: pack.amount, currency: this.config.currency, bucket: input.bucket, credits: pack.credits,
		});
		await charge.save();
		const result = await this.#requireProvider(input.ownerId).chargeOnce({
			customerId: account.providerCustomerId, currency: this.config.currency, amount: pack.amount,
			description: `${this.config.credits[input.bucket]!.label}: ${pack.credits}`, idempotencyKey: charge.idempotencyKey,
			risk: { accountId: account.id, accountCreatedAt: account.createdAt, ipAddress: input.ipAddress },
		});
		await this.#chargeResult(charge, result);
		return { status: result.status, ...(result.payUrl ? { payUrl: result.payUrl } : {}) };
	}

	async setAutoTopUp(input: { ownerId: string; bucket: string; pack: string | null }): Promise<void> {
		if (input.pack !== null && !this.#bucket(input.bucket).packs[input.pack]) throw new Error(`Credit pack ${input.pack} is not in db3/billing.json credits.${input.bucket}.`);
		const account = await this.#account(input.ownerId);
		const next = { ...(account.autoTopUp ?? {}) };
		if (input.pack === null) delete next[input.bucket];
		else next[input.bucket] = input.pack;
		account.autoTopUp = next;
		await account.save();
	}

	async invoicePeriod(period: BillingPeriod): Promise<{ invoiced: number; failed: number }> {
		const month = period.start.toISOString().slice(0, 7);
		const ids = new Set<string>();
		for (const span of await BillingUsageRecord.query().where('startedAt', '<', period.end).all()) {
			if (!span.endedAt || span.endedAt > period.start) ids.add(span.accountId);
		}
		for (const use of await BillingUseRecord.query().where('at', '>=', period.start).where('at', '<', period.end).all()) ids.add(use.accountId);
		let invoiced = 0;
		let failed = 0;
		for (const accountId of ids) {
			const account = await BillingAccount.findOrFail(accountId);
			const key = `invoice:${account.id}:${month}`;
			let charge = await BillingCharge.where('idempotencyKey', key).first();
			if (charge && charge.state !== 'pending') continue;
			if (!charge) {
				const lines = usageInvoiceLines(this.config, period, await this.#spans(account.id), await this.#uses(account.id));
				const amount = lines.reduce((sum, line) => sum + line.amount, 0);
				if (amount === 0) continue;
				charge = BillingCharge.create({ accountId: account.id, kind: 'invoice', idempotencyKey: key, state: 'pending', amount, currency: this.config.currency, periodStart: period.start, lines });
				await charge.save();
			}
			if (!account.providerCustomerId) {
				await this.#chargeResult(charge, { providerId: `none:${charge.id}`, status: 'failed' }, 'no saved card');
				failed++;
				continue;
			}
			const result = await this.#requireProvider(account.ownerId).chargeInvoice({
				customerId: account.providerCustomerId, currency: this.config.currency, lines: charge.lines ?? [],
				description: `Usage for ${month}`, idempotencyKey: key,
				risk: { accountId: account.id, accountCreatedAt: account.createdAt },
			});
			await this.#chargeResult(charge, result);
			if (result.status === 'failed') failed++;
			else invoiced++;
		}
		return { invoiced, failed };
	}

	async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
		const event = await this.#requireProvider('webhook').parseWebhook(rawBody, signature);
		let record = await BillingEventRecord.where('eventId', event.eventId).first();
		if (record?.processedAt) return;
		if (!record) {
			record = BillingEventRecord.create({ eventId: event.eventId, type: event.type, event });
			try {
				await record.save();
			} catch (error) {
				record = await BillingEventRecord.where('eventId', event.eventId).first();
				if (!record) throw error;
				if (record.processedAt) return;
			}
		}
		try {
			await this.applyEvent(event);
			record.processedAt = this.#now();
			record.error = null;
		} catch (error) {
			record.error = String((error as Error)?.message ?? error).slice(0, 1000);
			await record.save();
			throw error;
		}
		await record.save();
	}

	/** Applies one verified provider event. Public so stored events can be replayed. */
	async applyEvent(event: BillingProviderEvent): Promise<void> {
		if (event.type === 'ignored') return;
		const account = await BillingAccount.where('providerCustomerId', event.customerId).first();
		if (!account) return;
		if (event.type === 'card.saved') {
			Object.assign(account, {
				cardBrand: event.card.brand, cardLast4: event.card.last4, cardExpMonth: event.card.expMonth, cardExpYear: event.card.expYear,
				cardFingerprint: event.card.fingerprint, cardCountry: event.card.country,
			});
			if (account.status === 'none') account.status = 'active';
			await account.save();
			for (const wake of [...(this.#waiters.get(account.ownerId) ?? [])]) wake();
			return;
		}
		if (event.type === 'card.removed') {
			Object.assign(account, { cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null, cardFingerprint: null, cardCountry: null });
			await account.save();
			return;
		}
		const charge = await BillingCharge.where('providerId', event.providerId).first();
		if (!charge) return;
		if (event.type === 'charge.paid') return this.#markPaid(charge, account);
		if (event.type === 'charge.failed') return this.#markFailed(charge, account, event.reason);
		await this.#reverse(charge, account, event.type === 'charge.refunded' ? 'refunded' : 'disputed');
		if (event.type !== 'charge.refunded') {
			account.status = 'suspended';
			account.suspendedReason = event.type === 'charge.disputed' ? 'dispute' : 'fraud_warning';
			await account.save();
		}
	}

	async #chargeResult(charge: BillingCharge, result: { providerId: string; status: 'paid' | 'pending' | 'failed'; payUrl?: string }, reason?: string) {
		charge.providerId = result.providerId;
		charge.payUrl = result.payUrl ?? null;
		await charge.save();
		const account = await BillingAccount.findOrFail(charge.accountId);
		if (result.status === 'paid') await this.#markPaid(charge, account);
		if (result.status === 'failed') await this.#markFailed(charge, account, reason ?? 'declined');
	}

	async #markPaid(charge: BillingCharge, account: BillingAccount) {
		if (charge.state === 'paid' || charge.state === 'refunded' || charge.state === 'disputed') return;
		charge.state = 'paid';
		charge.paidAt = this.#now();
		charge.failureReason = null;
		await charge.save();
		if (charge.kind === 'credits') await this.#grant(account.id, charge.bucket!, charge.credits!, `charge:${charge.id}`);
		if (charge.kind === 'invoice') {
			account.firstPaidAt ??= charge.paidAt;
			const unpaid = await BillingCharge.where('accountId', account.id).where('kind', 'invoice').where('state', 'failed').count();
			if (unpaid === 0 && account.status === 'past_due') {
				account.status = 'active';
				account.pastDueSince = null;
			}
			await account.save();
		}
	}

	async #markFailed(charge: BillingCharge, account: BillingAccount, reason: string) {
		if (charge.state !== 'pending' && charge.state !== 'failed') return;
		charge.state = 'failed';
		charge.failureReason = reason.slice(0, 255);
		await charge.save();
		if (charge.kind === 'invoice' && account.status === 'active') {
			account.status = 'past_due';
			account.pastDueSince = this.#now();
			await account.save();
		}
	}

	async #reverse(charge: BillingCharge, account: BillingAccount, state: 'refunded' | 'disputed') {
		const wasPaid = charge.state === 'paid';
		charge.state = state;
		await charge.save();
		if (wasPaid && charge.kind === 'credits') await this.#grant(account.id, charge.bucket!, -charge.credits!, `reversal:${charge.id}`);
	}

	async #grant(accountId: string, bucket: string, amount: number, key: string) {
		if (await BillingCreditEntry.where('key', key).first()) return;
		try {
			await BillingCreditEntry.create({ accountId, bucket, amount, key }).save();
		} catch (error) {
			if (!(await BillingCreditEntry.where('key', key).first())) throw error;
		}
	}

	async #autoTopUp(account: BillingAccount, bucket: string, pack: string): Promise<boolean> {
		const pending = await BillingCharge.where('accountId', account.id).where('kind', 'credits').where('bucket', bucket).where('state', 'pending').first();
		if (pending) return true;
		try {
			const result = await this.buyCredits({ ownerId: account.ownerId, bucket, pack });
			return result.status !== 'failed';
		} catch {
			return false;
		}
	}

	async #customer(ownerId: string, name: string, email: string) {
		const account = await this.#account(ownerId);
		if (account.providerCustomerId) return account;
		const { customerId } = await this.#requireProvider(ownerId).createCustomer({ accountId: account.id, name, email, idempotencyKey: `customer:${account.id}` });
		account.providerCustomerId = customerId;
		await account.save();
		return account;
	}

	async #account(ownerId: string): Promise<BillingAccount> {
		const existing = await BillingAccount.where('ownerId', ownerId).first();
		if (existing) return existing;
		try {
			const account = BillingAccount.create({ ownerId, status: 'none' });
			await account.save();
			return account;
		} catch (error) {
			const raced = await BillingAccount.where('ownerId', ownerId).first();
			if (raced) return raced;
			throw error;
		}
	}

	async #locked<T>(accountId: string, callback: () => Promise<T>): Promise<T> {
		return BillingAccount.getDb().transaction((transaction) => ActiveRecord.withDb(transaction, async () => {
			await BillingAccount.where('id', accountId).forUpdate().firstOrFail();
			return callback();
		}));
	}

	async #balance(accountId: string, bucket: string): Promise<number> {
		const row = await BillingCreditEntry.where('accountId', accountId).where('bucket', bucket).toKnex().sum({ total: 'amount' }).first() as { total?: number | string | null } | undefined;
		return Number(row?.total ?? 0);
	}

	async #total(account: BillingAccount, period: BillingPeriod): Promise<number> {
		const lines = usageInvoiceLines(this.config, period, await this.#spans(account.id), await this.#uses(account.id));
		return lines.reduce((sum, line) => sum + line.amount, 0);
	}

	async #spans(accountId: string): Promise<BillingUsageSpan[]> {
		return (await BillingUsageRecord.where('accountId', accountId).all()).map(({ resourceId, price, startedAt, endedAt }) => ({ resourceId, price, startedAt, endedAt }));
	}

	async #uses(accountId: string): Promise<BillingUse[]> {
		return (await BillingUseRecord.where('accountId', accountId).all()).map(({ key, price, quantity, at }) => ({ key, price, quantity, at }));
	}

	#status(account: BillingAccount): BillingAccountStatus {
		if (account.status !== 'past_due') return account.status;
		const ends = this.#graceEndsAt(account);
		return ends && ends <= this.#now() ? 'suspended' : 'past_due';
	}

	#graceEndsAt(account: BillingAccount): Date | null {
		return account.status === 'past_due' && account.pastDueSince ? new Date(account.pastDueSince.getTime() + this.config.graceDays * DAY) : null;
	}

	#spendLimit(account: BillingAccount): number | null {
		if (account.spendLimit !== null && account.spendLimit !== undefined) return account.spendLimit;
		return account.firstPaidAt ? null : this.config.newAccountSpendLimit;
	}

	#bucket(bucket: string) {
		const config = this.config.credits[bucket];
		if (!config) throw new Error(`Credit bucket ${bucket} is not in db3/billing.json.`);
		return config;
	}

	#requireProvider(ownerId: string): BillingProvider {
		if (!this.#provider) throw new BillingNotSetUpError(ownerId, 'No billing provider is configured; pass billing.provider to App.');
		return this.#provider;
	}
}

function monthStart(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
