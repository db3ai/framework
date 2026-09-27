import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActiveRecord } from '@db3.ai/app/db';
import { App } from '@db3.ai/app';
import { UserIdentity } from '@db3.ai/app/auth';
import { InApp, InAppError, InAppRecord, type InAppMessage, type InAppScope } from '@db3.ai/app/in-app';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { sendReportReady } from '../examples/sendReportReady';

const account = { type: 'account' } as const;
const team = { type: 'organization', id: 'team-one' } as const;
const message: InAppMessage = { title: 'Ready', body: 'Your report is ready.', presentation: 'banner' };
let database: GeneratedTestDatabase;
let application: App;
let alice: UserIdentity;
let bob: UserIdentity;
let permitted: boolean;

beforeEach(async () => {
	database = await createGeneratedTestDatabase('in_app');
	permitted = true;
	application = new App({ db: database.db, inApp: { authorizeScope: (_id, scope) => scope.type === 'account' || (permitted && scope.id === team.id) } });
	await application.db.install(UserIdentity, InAppRecord);
	alice = UserIdentity.create({ name: 'Alice', email: 'alice@example.test' });
	bob = UserIdentity.create({ name: 'Bob', email: 'bob@example.test' });
	await alice.save();
	await bob.save();
});

afterEach(async () => {
	try { if (application) await application.close(); } finally { if (database) await database.destroy(); }
});

/** Executes a user operation with real isolated framework authentication. */
function asUser<T>(user: UserIdentity | null, callback: () => T): T { return application.auth.runWithUser(user, callback); }

/** Reads the current user's scoped inbox with normal defaults. */
function inbox(user: UserIdentity, scope: InAppScope = account) { return asUser(user, () => application.inApp.inbox({ scope })); }

describe('in-app inbox public contract', () => {
	it('invalidates committed writes and transitions, but not retries, rollbacks or reads', async () => {
		const changed: string[] = [];
		application.set('inApp', new InApp({ onChanged: userId => { changed.push(userId); } }));
		const send = () => application.inApp.send(String(alice.id), message, { scope: account, type: 'ready', key: 'committed' });
		await expect(application.db.transaction(async () => { await send(); expect(changed).toEqual([]); throw new Error('rollback'); })).rejects.toThrow('rollback');
		expect(changed).toEqual([]);
		let id = '';
		await application.db.transaction(async transaction => {
			await transaction.transaction(async () => { id = (await send())[0].id; });
			expect(changed).toEqual([]);
		});
		await expect.poll(() => changed).toEqual([String(alice.id)]);
		await send(); await inbox(alice);
		expect(changed).toHaveLength(1);
		await asUser(alice, () => application.inApp.update(id, 'read', account));
		expect(changed).toHaveLength(2);
		await asUser(alice, () => application.inApp.update(id, 'read', account));
		expect(changed).toHaveLength(2);
		await expect(application.db.transaction(async () => {
			await asUser(alice, () => application.inApp.update(id, 'dismiss', account));
			throw new Error('rollback');
		})).rejects.toThrow('rollback');
		expect(changed).toHaveLength(2);
	});

	it('keeps committed outer changes when a later savepoint rolls back', async () => {
		const changed: string[] = [];
		application.set('inApp', new InApp({ onChanged: async userId => {
			// A deferred hook must use a fresh connection, never the completed transaction.
			expect(await InAppRecord.where('userId', userId).count()).toBe(1);
			changed.push(userId);
		} }));
		await application.db.transaction(async transaction => {
			await application.inApp.send(String(alice.id), message, { scope: account, type: 'outer' });
			await expect(transaction.transaction(async () => {
				await application.inApp.send(String(bob.id), message, { scope: account, type: 'inner' });
				throw new Error('savepoint rollback');
			})).rejects.toThrow('savepoint rollback');
			expect(changed).toEqual([]);
		});
		await expect.poll(() => changed).toEqual([String(alice.id)]);
	});

	it('suppresses invalidation on explicit transaction rollback and contains delivery failures', async () => {
		const changed: string[] = []; const errors: unknown[] = [];
		application.set('inApp', new InApp({ onChanged: userId => { changed.push(userId); throw new Error('broker unavailable'); }, onDeliveryError: error => { errors.push(error); } }));
		const transaction = await database.db.transaction();
		await ActiveRecord.withDb(transaction, () => application.inApp.send(String(alice.id), message, { scope: account, type: 'rollback' }));
		await transaction.rollback();
		await transaction.executionPromise;
		expect(changed).toEqual([]);
		expect(await InAppRecord.query().count()).toBe(0);
		await expect(application.inApp.send(String(alice.id), message, { scope: account, type: 'persisted' })).resolves.toHaveLength(1);
		expect(changed).toEqual([String(alice.id)]);
		expect(errors).toHaveLength(1);
		expect((await inbox(alice)).items).toHaveLength(1);
	});

	it('runs the shipped example and restores the inbox through a fresh service', async () => {
		const [accepted] = await sendReportReady(String(alice.id), 'report-1');
		application.set('inApp', new InApp());
		const page = await inbox(alice);
		expect(page.unreadCount).toBe(1);
		expect(page.items[0]).toMatchObject({ id: accepted.id, message: { title: 'Your report is ready', presentation: 'banner', action: { href: '/reports/report-1' } }, readAt: null, dismissedAt: null });
		expect(JSON.stringify(page)).not.toMatch(/deduplicationHash|contentHash|userId/);
		expect(await inbox(bob)).toMatchObject({ items: [], unreadCount: 0 });
	});

	it('deduplicates concurrent retries and recipient aliases, keeping per-recipient state', async () => {
		const ids = [String(alice.id), String(bob.id), String(alice.id).toLowerCase()];
		const options = { scope: team, type: 'report.ready', key: 'one' };
		const [first, second] = await Promise.all([application.inApp.send(ids, message, options), application.inApp.send(ids, message, options)]);
		expect(first).toHaveLength(2);
		expect(first.map(item => item.id)).toEqual(second.map(item => item.id));
		expect(await InAppRecord.query().count()).toBe(2);
		await asUser(alice, () => application.inApp.update(first[0].id, 'read', team));
		expect((await inbox(alice, team)).unreadCount).toBe(0);
		expect((await inbox(bob, team)).unreadCount).toBe(1);
	});

	it('rejects conflicting keys atomically, including previously inserted recipients in that batch', async () => {
		const options = { scope: account, type: 'report.ready', key: 'one' };
		await application.inApp.send(String(bob.id), message, options);
		await expect(application.inApp.send([String(alice.id), String(bob.id)], { ...message, body: 'Changed' }, options)).rejects.toMatchObject({ code: 'conflict' });
		expect(await InAppRecord.query().count()).toBe(1);
		expect((await inbox(bob)).items[0].message.body).toBe(message.body);
		expect((await inbox(alice)).items).toEqual([]);
		await application.inApp.send(String(bob.id), message, { ...options, type: 'report.other' });
		await application.inApp.send(String(bob.id), message, { ...options, scope: team });
		expect(await InAppRecord.query().count()).toBe(3);
	});

	it('rolls back with an outer domain transaction and creates new occurrences without keys', async () => {
		await expect(application.db.transaction(async () => {
			await application.inApp.send(String(alice.id), message, { scope: account, type: 'report.ready' });
			throw new Error('Domain change failed');
		})).rejects.toThrow('Domain change failed');
		expect(await InAppRecord.query().count()).toBe(0);
		for (let index = 0; index < 2; index++) await application.inApp.send(String(alice.id), message, { scope: account, type: 'report.ready' });
		expect(await InAppRecord.query().count()).toBe(2);
	});

	it('preserves deduplication when the caller retries a stale domain transaction', async () => {
		const options = { scope: account, type: 'report.ready', key: 'snapshot' };
		let firstId: string | undefined;
		/** Retries the whole domain transaction, never a fragment of a failed transaction. */
		async function dispatchWithinDomain() {
			return application.db.transaction(async () => {
				await InAppRecord.query().count();
				if (!firstId) {
					const [first] = await ActiveRecord.withDb(database.db, () => application.inApp.send(String(alice.id), message, options));
					firstId = first.id;
				}
				return application.inApp.send(String(alice.id), message, options);
			});
		}
		let result;
		try { result = await dispatchWithinDomain(); } catch (error) {
			// MariaDB may reject a current read after a concurrent insert into an old snapshot.
			if ((error as { errno?: number }).errno !== 1020) throw error;
			result = await dispatchWithinDomain();
		}
		expect(result[0]).toMatchObject({ id: firstId, status: 'existing' });
		expect(await InAppRecord.query().count()).toBe(1);
	});

	it('keeps banner dismissal, read and archive independent and idempotent', async () => {
		const [item] = await application.inApp.send(String(alice.id), message, { scope: account, type: 'report.ready' });
		await asUser(alice, async () => {
			await application.inApp.update(item.id, 'read', account);
			expect((await application.inApp.inbox({ scope: account, view: 'banners' })).items).toHaveLength(1);
			await application.inApp.update(item.id, 'unread', account);
			await application.inApp.update(item.id, 'dismiss', account);
			const first = await application.inApp.inbox({ scope: account });
			await application.inApp.update(item.id, 'dismiss', account);
			expect((await application.inApp.inbox({ scope: account })).items[0].dismissedAt).toBe(first.items[0].dismissedAt);
			expect(first.unreadCount).toBe(1);
			expect((await application.inApp.inbox({ scope: account, view: 'banners' })).items).toEqual([]);
			await application.inApp.update(item.id, 'archive', account);
			expect(await application.inApp.inbox({ scope: account })).toMatchObject({ items: [], unreadCount: 0 });
		});
	});

	it('enforces request authentication, ownership, scope isolation and changing scope permission', async () => {
		const [item] = await application.inApp.send(String(alice.id), message, { scope: team, type: 'report.ready' });
		await expect(application.inApp.inbox({ scope: team })).rejects.toMatchObject({ code: 'unauthenticated' });
		await expect(asUser(null, () => application.inApp.inbox({ scope: team }))).rejects.toMatchObject({ code: 'unauthenticated' });
		await expect(asUser(bob, () => application.inApp.update(item.id, 'dismiss', team))).rejects.toMatchObject({ code: 'not_found' });
		await expect(asUser(alice, () => application.inApp.update(item.id, 'read', account))).rejects.toMatchObject({ code: 'not_found' });
		expect((await inbox(alice)).items).toEqual([]);
		permitted = false;
		await expect(inbox(alice, team)).rejects.toMatchObject({ code: 'forbidden' });
		await expect(asUser(alice, () => application.inApp.update(item.id, 'read', team))).rejects.toMatchObject({ code: 'forbidden' });
		await expect(application.inApp.send(String(alice.id), message, { scope: team, type: 'report.ready' })).rejects.toMatchObject({ code: 'forbidden' });
		application.set('inApp', new InApp());
		await expect(inbox(alice, team)).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('uses the configured identity model and lets account policies restrict writes', async () => {
		/** Application-owned identity table, independent of the default users table. */
		class Member extends UserIdentity { static override table = 'members'; }
		await application.close();
		application = new App({ db: database.db, auth: { identityModel: Member }, inApp: { authorizeScope: (_id, _scope, operation) => operation !== 'update' } });
		await application.db.install(Member);
		const member = Member.create({ name: 'Member', email: 'member@example.test' });
		await member.save();
		const [accepted] = await application.inApp.send(String(member.id), message, { scope: account, type: 'report.ready' });
		expect((await inbox(member)).items[0].id).toBe(accepted.id);
		await expect(asUser(member, () => application.inApp.update(accepted.id, 'read', account))).rejects.toMatchObject({ code: 'forbidden' });
		await expect(application.inApp.send(String(alice.id), message, { scope: account, type: 'report.ready' })).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('paginates without duplicating entries and never marks a fetched page read', async () => {
		for (let index = 0; index < 4; index++) await application.inApp.send(String(alice.id), { ...message, presentation: 'toast' }, { scope: account, type: 'report.ready' });
		await asUser(alice, async () => {
			const first = await application.inApp.inbox({ scope: account, limit: 2 });
			const second = await application.inApp.inbox({ scope: account, limit: 2, before: first.nextBefore! });
			expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);
			expect(first.unreadCount).toBe(4);
			expect(second.nextBefore).toBeNull();
			expect((await application.inApp.inbox({ scope: account, view: 'banners' })).items).toEqual([]);
		});
	});

	it('validates recipients, presentation and action URLs before creating any records', async () => {
		const options = { scope: account, type: 'report.ready' };
		expect(await application.inApp.send([], message, options)).toEqual([]);
		await expect(application.inApp.send([String(alice.id), 'missing'], message, options)).rejects.toMatchObject({ code: 'forbidden' });
		const credentialUrl = new URL('https://example.test');
		credentialUrl.username = 'test-user';
		credentialUrl.password = 'test-password';
		for (const href of ['javascript:alert(1)', '//evil.test', '/\\evil.test', credentialUrl.href, ' https://example.test']) {
			await expect(application.inApp.send(String(alice.id), { ...message, action: { label: 'Open', href } }, options)).rejects.toBeInstanceOf(InAppError);
		}
		await expect(application.inApp.send(String(alice.id), { ...message, title: ' ' }, options)).rejects.toMatchObject({ code: 'invalid' });
		await expect(application.inApp.send(String(alice.id), message, { ...options, scope: { type: 'account', id: 'other' } })).rejects.toMatchObject({ code: 'invalid' });
		await expect(asUser(alice, () => application.inApp.inbox({ scope: account, limit: 101 }))).rejects.toMatchObject({ code: 'invalid' });
		expect(await InAppRecord.query().count()).toBe(0);
	});

	it('stores an optional rich body while retaining a required plain-text fallback', async () => {
		const bodyHtml = '<p>Your <strong>report</strong> is ready.</p>';
		await application.inApp.send(String(alice.id), { ...message, bodyHtml }, { scope: account, type: 'report.rich' });
		expect((await inbox(alice)).items[0].message).toMatchObject({ body: message.body, bodyHtml });
		await expect(application.inApp.send(String(alice.id), { ...message, bodyHtml: ' ' }, { scope: account, type: 'report.invalid' })).rejects.toMatchObject({ code: 'invalid' });
	});
});
