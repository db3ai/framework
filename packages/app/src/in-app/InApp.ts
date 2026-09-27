import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { ActiveRecord } from '../db';
import { UserIdentity, type UserIdentityModel } from '../auth';
import { app } from '../server/appContext';
import { InAppRecord } from './InAppRecord';
import { InAppError } from './InAppError';
import { normalizeMessage, normalizeQuery, normalizeRecipients, normalizeScope, normalizeSend } from './validation';
import type * as inbox from './contracts';

/** Persistent in-app inbox independent of notification classes, email and live delivery. */
export class InApp {
	readonly #commits = new WeakMap<Knex.Transaction, Promise<boolean>>();
	/** Creates the service; ordinary applications use app().inApp and App's configured Auth identity model. */
	constructor(readonly options: inbox.InAppOptions = {}, readonly identityModel: UserIdentityModel = UserIdentity) {}

	/**
	 * Atomically accepts one message for up to 100 distinct recipients.
	 * Trusted server code owns sender authorization. The service validates identities and receive-scope policy.
	 * @param recipients - User ID or IDs; an empty list creates no work.
	 * @param message - Inbox content with a required plain-text fallback and optional rich body.
	 * @param options - Explicit scope, notification type and optional deduplication key.
	 * @returns Per-recipient durable acceptance, never a claim of browser delivery.
	 * @example await app().inApp.send(userId, { title: 'Ready', body: 'Your report is ready.' }, { scope: { type: 'account' }, type: 'report.ready' });
	 */
	async send(recipients: string | readonly string[], message: inbox.InAppMessage, options: inbox.InAppSendOptions): Promise<inbox.InAppAcceptance[]> {
		const ids = normalizeRecipients(recipients);
		const content = normalizeMessage(message);
		const input = normalizeSend(options);
		const contentHash = hash(content);
		if (!ids.length) return [];
		const connection = InAppRecord.getDb();
		const committed = this.#committed(connection);
		const accepted = await connection.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
			// Lock in stable order so concurrent batches and retries cannot deadlock by recipient order.
			const canonicalIds = new Map<string, string>();
			for (const userId of [...ids].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))) {
				const row = await this.identityModel.where(this.identityModel.primaryKey, userId).toKnex().forUpdate().first();
				if (!row) throw new InAppError('forbidden', 'Notification recipient is unavailable.');
				const canonicalId = String(this.identityModel.fromDb(row).get(this.identityModel.primaryKey));
				canonicalIds.set(userId, canonicalId);
				await this.#authorize(canonicalId, input.scope, 'receive');
			}
			const results: inbox.InAppAcceptance[] = [];
			for (const userId of new Set(ids.map(id => canonicalIds.get(id)!))) {
				const deduplicationHash = input.key === undefined ? null : hash([userId, input.scope.type, scopeId(input.scope), input.type, input.key]);
				// Request a current read; stale outer snapshots may require a caller-owned transaction retry.
				const existingRow = deduplicationHash ? await InAppRecord.where('deduplicationHash', deduplicationHash).toKnex().forUpdate().first() : null;
				const existing = existingRow ? InAppRecord.fromDb(existingRow) : null;
				if (existing) {
					if (existing.contentHash !== contentHash) throw new InAppError('conflict', 'This notification key already has different content.');
					results.push({ userId, id: existing.id, status: 'existing' });
					continue;
				}
				const record = InAppRecord.create({ userId, scopeType: input.scope.type, scopeId: scopeId(input.scope), type: input.type, message: content, presentation: content.presentation, deduplicationHash, contentHash });
				await record.save();
				results.push({ userId, id: record.id, status: 'created' });
			}
			return results;
		}));
		await this.#changed(accepted.filter(item => item.status === 'created').map(item => item.userId), committed);
		return accepted;
	}

	/**
	 * Lists only the authenticated user's unarchived items in an authorized scope.
	 * @param query - Scope, page size, optional position and inbox/banner view.
	 * @returns Safe content, unread count and next-page position. Reading a page changes no state.
	 */
	async inbox(query: inbox.InAppInboxQuery): Promise<inbox.InAppInboxPage> {
		const input = normalizeQuery(query);
		const userId = await this.#reader(input.scope, 'read');
		const rows = this.#query(userId, input.scope).whereNull('archivedAt');
		if (input.view === 'banners') rows.where('presentation', 'banner').whereNull('dismissedAt');
		if (input.before) rows.where('id', '<', input.before);
		const records = await rows.orderBy('id', 'desc').limit(input.limit + 1).all();
		const unreadCount = await this.#query(userId, input.scope).whereNull('archivedAt').whereNull('readAt').count();
		const items = records.slice(0, input.limit).map(itemView);
		return { items, unreadCount, nextBefore: records.length > input.limit ? items.at(-1)!.id : null };
	}

	/**
	 * Changes one owned item's read, dismissal or archive state without coupling those states.
	 * @param id - Inbox item ID; a foreign or missing ID returns the same not-found error.
	 * @param transition - Explicit recipient action.
	 * @param scope - Currently authorized scope, never inferred from the target item.
	 */
	async update(id: string, transition: inbox.InAppTransition, scope: inbox.InAppScope): Promise<void> {
		const input = normalizeScope(scope);
		if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || !['read', 'unread', 'dismiss', 'archive'].includes(transition)) throw new InAppError('invalid', 'Invalid inbox state change.');
		const userId = await this.#reader(input, 'update');
		const query = this.#query(userId, input).where('id', id);
		if (!await query.first()) throw new InAppError('not_found', 'Inbox item not found.');
		const field = transition === 'dismiss' ? 'dismissedAt' : transition === 'archive' ? 'archivedAt' : 'readAt';
		const committed = this.#committed(InAppRecord.getDb());
		const update = this.#query(userId, input).where('id', id);
		if (transition !== 'unread') update.whereNull(field);
		const count = await update.patch({ [field]: transition === 'unread' ? null : new Date() });
		if (count) await this.#changed([userId], committed);
	}

	/** Observes all surrounding savepoints and the outer commit, including explicit rollback without an error. */
	#committed(connection: Knex): Promise<boolean> | undefined {
		if (!this.options.onChanged || !connection.isTransaction) return;
		const transactions: Promise<boolean>[] = [];
		let current: Knex.Transaction | undefined = connection as Knex.Transaction;
		while (current) {
			const transaction: Knex.Transaction = current;
			let result = this.#commits.get(transaction);
			if (!result) {
				let rolledBack = false;
				/** The final control statement distinguishes silent rollback from commit or savepoint release. */
				const query = (event: { sql: string }): void => {
					if (/^ROLLBACK/i.test(event.sql)) rolledBack = true;
					else if (/^(COMMIT|RELEASE SAVEPOINT)/i.test(event.sql)) rolledBack = false;
				};
				transaction.on('query', query);
				result = transaction.executionPromise.then(() => !rolledBack, () => false).finally(() => transaction.off('query', query));
				this.#commits.set(transaction, result);
			}
			transactions.push(result);
			current = transaction.parentTransaction;
		}
		return Promise.all(transactions).then(results => results.every(Boolean));
	}

	/** Publishes only committed recipient changes; nested transactions defer without blocking their own commit. */
	async #changed(userIds: string[], committed?: Promise<boolean>): Promise<void> {
		if (!this.options.onChanged || !userIds.length) return;
		const connection = app().db.knex;
		/** Contains push failures so retrying notification delivery cannot duplicate an accepted message. */
		const deliver = async (): Promise<void> => ActiveRecord.withDb(connection, async () => {
			await Promise.all([...new Set(userIds)].map(async userId => {
				try { await this.options.onChanged!(userId); }
				catch (error) { try { this.options.onDeliveryError?.(error); } catch { /* Reporting cannot undo the write. */ } }
			}));
		});
		if (committed) { void committed.then(success => { if (success) return deliver(); }); }
		else await deliver();
	}

	/** Builds an ownership-scoped query; callers never accept a reader ID from a browser. */
	#query(userId: string, scope: inbox.InAppScope) {
		return InAppRecord.where('userId', userId).where('scopeType', scope.type).where('scopeId', scopeId(scope));
	}

	/** Requires isolated request authentication and current scope authorization on every operation. */
	async #reader(scope: inbox.InAppScope, operation: 'read' | 'update'): Promise<string> {
		const application = app();
		const user = application.requestContext.active ? application.auth.user : null;
		if (!user) throw new InAppError('unauthenticated', 'Sign in to access your inbox.');
		const userId = String(user.get(this.identityModel.primaryKey));
		await this.#authorize(userId, scope, operation);
		return userId;
	}

	/** Account ownership is built in; application scopes require an explicit policy. */
	async #authorize(userId: string, scope: inbox.InAppScope, operation: 'receive' | 'read' | 'update'): Promise<void> {
		if (scope.type === 'account' && !this.options.authorizeScope) return;
		if (!await this.options.authorizeScope?.(userId, scope, operation)) throw new InAppError('forbidden', 'Notification scope is unavailable.');
	}
}

/** Uses a nonempty sentinel only for the explicitly typed account scope. */
function scopeId(scope: inbox.InAppScope): string { return scope.type === 'account' ? 'account' : scope.id!; }

/** Hashes a normalized value; array envelopes avoid ambiguous delimiter concatenation. */
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Serializes only the public inbox contract, never routing or deduplication internals. */
function itemView(record: InAppRecord): inbox.InAppItem {
	return { id: record.id, type: record.type, message: record.message, createdAt: record.createdAt.toISOString(), readAt: record.readAt?.toISOString() ?? null, dismissedAt: record.dismissedAt?.toISOString() ?? null, archivedAt: record.archivedAt?.toISOString() ?? null };
}
