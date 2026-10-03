import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ActiveRecord, Database } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Log } from '@db3.ai/app/logging';
import { Mail, MailDeliveryError, type ResolvedMailMessage } from '@db3.ai/app/mail';
import { OperationalAlerts, OperationalAlertRecord } from '@db3.ai/app/notifications';

let database: GeneratedTestDatabase;
const log = new Log({ level: 'silent' });
const messages: ResolvedMailMessage[] = [];
let refusal: Error | null = null;
const mail = new Mail({ transport: {
	/** Captures the provider boundary, allowing real SQL claims and acknowledgements to run. */
	async send(message) {
		messages.push(message);
		if (refusal) throw refusal;
		return { id: 'accepted', transport: 'test', accepted: ['operator@example.test'], rejected: [] };
	},
} });

/** Constructs a new dispatcher over the same durable database state. */
function outbox(): OperationalAlerts {
	return new OperationalAlerts({ email: 'operator@example.test', webhookUrl: 'https://alerts.example.test', webhookSecret: 'test' }, mail, log);
}

/** Runs each scenario against the disposable SQL database. */
async function scoped(run: () => Promise<void>): Promise<void> {
	await ActiveRecord.withDb(database.db, run);
}

/** Records a known same-cause cohort without collapsing individual incident evidence. */
async function cohort(count: number): Promise<void> {
	for (let index = 0; index < count; index++) await outbox().record({ key: `failure:${index}`, summary: 'Known provider quota failure', context: { jobId: index }, emailGroupKey: 'provider:quota', emailDiagnostics: `Evidence ${index}` });
}

beforeAll(async () => {
	database = await createGeneratedTestDatabase('operational_email_policy');
	await new Database(database.db).install(OperationalAlertRecord);
});
beforeEach(async () => {
	await database.db(OperationalAlertRecord.table).delete();
	messages.length = 0;
	refusal = null;
	vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await database?.destroy(); await log.close(); });

it('shares one durable quota cooldown across concurrent and restarted dispatchers while webhooks continue', async () => scoped(async () => {
	await cohort(12);
	refusal = new MailDeliveryError('quota', 'resend', 429, 'daily_quota_exceeded');
	await Promise.all([outbox().deliverDue(20), outbox().deliverDue(20)]);
	expect(messages).toHaveLength(1);
	await outbox().record({ key: 'fresh', summary: 'A distinct fresh failure', context: {} });
	await outbox().deliverDue(20);
	expect(messages).toHaveLength(1);
	const dispatch = (await OperationalAlertRecord.where('kind', 'email-dispatch').first())!;
	expect(dispatch.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600000);
	const records = await OperationalAlertRecord.where('kind', 'incident').all();
	expect(records).toHaveLength(13);
	expect(records.every(record => record.emailSentAt === null && record.completedAt === null && record.webhookSentAt instanceof Date)).toBe(true);
}));

it('retains immutable digest identity through rejection, new arrivals and a crash-expired coordinator', async () => scoped(async () => {
	await cohort(12);
	refusal = new MailDeliveryError('quota', 'resend', 429, 'daily_quota_exceeded');
	await outbox().deliverDue(20);
	const original = messages[0];
	const digest = (await OperationalAlertRecord.where('kind', 'email-digest').first())!;
	expect(digest.memberIds).toHaveLength(12);
	await outbox().record({ key: 'later', summary: 'Later same cause', context: {}, emailGroupKey: 'provider:quota' });
	await outbox().record({ key: 'distinct', summary: 'Distinct fresh failure', context: {} });
	await OperationalAlertRecord.where('kind', 'email-dispatch').patch({ claim: 'crashed', nextAttemptAt: new Date(Date.now() - 60000) });
	refusal = null;
	await outbox().deliverDue(3);
	expect(messages[1].subject).toContain('Distinct fresh failure');
	expect(messages[2]).toEqual(original);
	expect((await OperationalAlertRecord.where('id', digest.id).first())?.memberIds).toEqual(digest.memberIds);
	const members = await OperationalAlertRecord.query().whereIn('id', digest.memberIds!).all();
	expect(members.every(record => record.emailSentAt instanceof Date && record.alert.emailDiagnostics?.startsWith('Evidence'))).toBe(true);
	await outbox().deliverDue(20);
	expect(messages.filter(message => message.idempotencyKey === original.idempotencyKey)).toHaveLength(2);
}));

it('honours provider retry timing and distinguishes ordinary throttling from daily quota exhaustion', async () => scoped(async () => {
	await cohort(2);
	const retryAt = new Date(Date.now() + 180000);
	refusal = new MailDeliveryError('quota', 'resend', 429, 'daily_quota_exceeded', retryAt);
	await outbox().deliverDue();
	expect((await OperationalAlertRecord.where('kind', 'email-dispatch').first())!.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(retryAt.getTime() - 1000);
	await OperationalAlertRecord.where('kind', 'email-dispatch').patch({ nextAttemptAt: new Date(Date.now() - 1000), attempts: 0 });
	refusal = new MailDeliveryError('throttle', 'resend', 429, 'rate_limit_exceeded');
	await outbox().deliverDue();
	const delay = (await OperationalAlertRecord.where('kind', 'email-dispatch').first())!.nextAttemptAt.getTime() - Date.now();
	expect(delay).toBeGreaterThan(50000);
	expect(delay).toBeLessThan(70000);
}));

it('bounds cohorts at the existing batch maximum and keeps different causes and recipients separate', async () => scoped(async () => {
	await cohort(101);
	await outbox().record({ key: 'other', summary: 'Different cause', context: {}, emailGroupKey: 'other:quota' });
	await new OperationalAlerts({ email: 'other@example.test' }, mail, log).record({ key: 'recipient', summary: 'Other recipient', context: {}, emailGroupKey: 'provider:quota' });
	await outbox().deliverDue(20);
	const digests = await OperationalAlertRecord.where('kind', 'email-digest').all();
	expect(digests).toHaveLength(4);
	expect(digests.map(digest => digest.memberIds!.length).sort((a, b) => a - b)).toEqual([1, 1, 1, 100]);
	expect(messages).toHaveLength(4);
	expect(await OperationalAlertRecord.where('kind', 'incident').count()).toBe(103);
}));
