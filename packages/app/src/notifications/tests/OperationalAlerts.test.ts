import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { ActiveRecord, Database } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Log } from '@db3.ai/app/logging';
import { Mail, type ResolvedMailMessage } from '@db3.ai/app/mail';
import { OperationalAlerts, OperationalAlertRecord } from '@db3.ai/app/notifications';

let database: GeneratedTestDatabase;
const messages: ResolvedMailMessage[] = [];
const log = new Log({ level: 'silent' });
const mail = new Mail({ transport: {
	/** Captures provider-bound messages without contacting an email service. */
	async send(message) {
		messages.push(message);
		return { id: 'accepted', transport: 'test', accepted: ['operator@example.test'], rejected: [] };
	},
} });
const alert = { key: 'failure:one', summary: 'A job failed', context: { jobId: '123' } };

/** Runs assertions against an isolated real database. */
async function scoped(run: () => Promise<void>): Promise<void> {
	await ActiveRecord.withDb(database.db, run);
}

/** Builds the outbox with controlled external destinations. */
function outbox(): OperationalAlerts {
	return new OperationalAlerts({ email: 'operator@example.test', webhookUrl: 'https://alerts.example.test/events', webhookSecret: 'test-signing-key' }, mail, log);
}

describe('durable operational alerts', () => {
	beforeAll(async () => {
		database = await createGeneratedTestDatabase('operational_alerts');
		await new Database(database.db).install(OperationalAlertRecord);
	});
	beforeEach(async () => {
		await database.db(OperationalAlertRecord.table).delete();
		messages.length = 0;
	});
	afterEach(() => vi.unstubAllGlobals());
	afterAll(async () => { await database?.destroy(); await log.close(); });

	it('deduplicates concurrent recorders and dispatchers and signs the exact stable payload', async () => scoped(async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', fetcher);
		const alerts = outbox();
		await Promise.all([alerts.record(alert), alerts.record(alert)]);
		await Promise.all([alerts.deliverDue(), alerts.deliverDue()]);
		expect(messages).toHaveLength(1);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const request = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
		const headers = request.headers as Record<string, string>;
		expect(headers['x-alert-signature']).toBe(createHmac('sha256', 'test-signing-key').update(`${headers['x-alert-timestamp']}.${request.body}`).digest('hex'));
		expect(request.redirect).toBe('error');
		expect(request.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(String(request.body))).toMatchObject(alert);
		expect(messages[0].text).toContain('Job Id: 123');
		expect(messages[0].text).toContain('Log correlation key: failure:one');
		expect(messages[0].html).toContain('<h2>A job failed</h2>');
		await alerts.record(alert);
		await alerts.deliverDue();
		expect(messages).toHaveLength(1);
	}));

	it('escapes email HTML and renders missing diagnostics explicitly while preserving webhook JSON', async () => scoped(async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', fetcher);
		await outbox().record({ key: 'escaping', summary: 'Failed <job>', context: { errorCode: null, details: '<img src=x onerror="alert(1)">&' } });
		await outbox().deliverDue();
		expect(messages[0].html).not.toContain('<img');
		expect(messages[0].html).toContain('&lt;img');
		expect(messages[0].html).toContain('Failed &lt;job&gt;');
		expect(messages[0].text).toContain('Error Code: Unknown');
		expect(messages[0].text).toContain('snapshot at detection time');
	}));

	it('retries a rejected webhook without resending accepted email after restart', async () => scoped(async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
		await outbox().record(alert);
		await outbox().deliverDue();
		let row = await OperationalAlertRecord.where('key', alert.key).first();
		expect(row?.emailSentAt).toBeInstanceOf(Date);
		expect(row?.completedAt).toBeNull();
		await OperationalAlertRecord.where('key', alert.key).patch({ nextAttemptAt: new Date(Date.now() - 60000) });
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
		await outbox().deliverDue();
		row = await OperationalAlertRecord.where('key', alert.key).first();
		expect(row?.completedAt).toBeInstanceOf(Date);
		expect(messages).toHaveLength(1);
	}));

	it('delivers persisted exception text only to email, escaped, and excludes it from signed webhooks', async () => scoped(async () => {
		const fetcher = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', fetcher);
		const diagnostics = 'Error: <private-detail>\n    at handle (/app/job.ts:3:4)' + '\nAdditional log context'.repeat(1000);
		await outbox().record({ ...alert, emailDiagnostics: diagnostics });
		await outbox().deliverDue();
		expect(messages[0].text).toContain(diagnostics);
		expect(messages[0].html).toContain('&lt;private-detail&gt;');
		expect(messages[0].html).not.toContain('<private-detail>');
		const request = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(JSON.parse(String(request.body))).not.toHaveProperty('emailDiagnostics');
		expect(String(request.body)).not.toContain('private-detail');
		const headers = request.headers as Record<string, string>;
		expect(headers['x-alert-signature']).toBe(createHmac('sha256', 'test-signing-key').update(`${headers['x-alert-timestamp']}.${request.body}`).digest('hex'));
	}));

	it('rejects oversized email diagnostics without persisting an incident', async () => scoped(async () => {
		await expect(outbox().record({ ...alert, emailDiagnostics: 'x'.repeat(128001) })).rejects.toThrow('128,000');
		expect(await OperationalAlertRecord.query().count()).toBe(0);
	}));

	it('preserves an active claim and recovers a crashed dispatcher after lease expiry', async () => scoped(async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
		await outbox().record(alert);
		await OperationalAlertRecord.where('key', alert.key).patch({ claim: 'crashed', nextAttemptAt: new Date(Date.now() + 300000) });
		expect(await outbox().deliverDue()).toBe(0);
		await OperationalAlertRecord.where('key', alert.key).patch({ nextAttemptAt: new Date(Date.now() - 60000) });
		expect(await outbox().deliverDue()).toBe(1);
	}));

	it('rejects unsafe endpoint configuration before sending', () => {
		expect(() => new OperationalAlerts({ webhookUrl: 'http://example.test', webhookSecret: 'key' }, mail, log)).toThrow('HTTPS');
		expect(() => new OperationalAlerts({ webhookUrl: 'https://example.test' }, mail, log)).toThrow('signing secret');
	});
});
