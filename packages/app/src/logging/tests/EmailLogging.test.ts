import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { Log } from '@db3.ai/app/logging';
import { App, registerHttpErrorHandler } from '@db3.ai/app/server';
import { Mail, type ResolvedMailMessage } from '@db3.ai/app/mail';

const logs: Log[] = [];
afterEach(async () => { for (const log of logs.splice(0)) await log.close(); vi.restoreAllMocks(); });

/** Uses real logging and Mail; only the external provider's submission is replaced. */
function fixture(send?: (message: ResolvedMailMessage) => Promise<void>) {
	const messages: ResolvedMailMessage[] = [];
	const mail = new Mail({ transport: { async send(message) {
		messages.push(message);
		await send?.(message);
		return { id: String(messages.length), transport: 'test', accepted: ['operator@example.test'], rejected: [] };
	} } });
	const log = new Log({ level: 'trace', console: false, devtools: false, redact: ['privateValue'], transports: [{ type: 'email', ...{ to: 'operator@example.test', subjectPrefix: 'Scout' } }] }, () => mail);
	logs.push(log);
	return { log, mail, messages };
}

it('sends 200 identical exceptions as 200 separate emails, without deduplication or digests', async () => {
	const { log, messages } = fixture();
	for (let index = 0; index < 200; index++) log.error({ err: new Error('Same failure'), incidentKey: 'same', index }, 'Job failed');
	await log.close();
	expect(messages).toHaveLength(200);
	expect(messages.every(message => message.subject === 'Scout: Job failed' && !message.idempotencyKey)).toBe(true);
	expect(messages[199].text).toContain('"index": 199');
});

it('routes error/fatal, direct Error calls and child loggers through redaction and escaped formatting', async () => {
	const { log, messages } = fixture();
	log.info('Normal'); log.warn('Expected deferral');
	const error = Object.assign(new Error('<script> password="SECRET"', { cause: new Error('Provider failed') }), { payload: 'PRIVATE_PAYLOAD' });
	log.child({ requestId: 'request-1', privateValue: 'PRIVATE_VALUE' }).error({ err: error, token: 'PRIVATE_TOKEN', requestUrl: 'https://user:pass@host/path?token=PRIVATE_URL' }, 'Request failed');
	log.error(new Error('Direct exception'));
	log.fatal('Fatal record');
	await log.flush();
	expect(messages).toHaveLength(3);
	expect(messages[0].text).toContain('request-1');
	expect(messages[0].text).toContain('Provider failed');
	expect(messages[0].text).toContain('Stack trace:');
	expect(messages[0].html).toContain('&lt;script&gt;');
	expect(messages[0].html).not.toContain('<script>');
	expect(messages[0].text).not.toMatch(/SECRET|PRIVATE_|user:pass/);
	expect(messages[1].text).toContain('Direct exception');
});

it('continues after provider refusal and cannot recursively email errors emitted while sending mail', async () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	let calls = 0;
	const { log, messages } = fixture(async () => {
		log.error({ err: new Error('Mail provider diagnostic') }, 'Sending mail failed');
		if (++calls === 1) throw new Error('Provider quota refusal');
	});
	log.error('First'); log.error('Second');
	await log.flush();
	expect(messages).toHaveLength(2);
	expect(stderr).toHaveBeenCalledTimes(1);
	expect(stderr.mock.calls[0][0]).not.toContain('Provider quota refusal');
});

it('waits for an outstanding asynchronous delivery during application shutdown', async () => {
	let finish!: () => void;
	const gate = new Promise<void>(resolve => { finish = resolve; });
	const { mail, messages } = fixture(() => gate);
	const application = new App({ log: { level: 'error', console: false, devtools: false, transports: [{ type: 'email', ...{ to: 'operator@example.test' } }] } });
	application.set('mail', mail);
	application.log.error('Before close');
	let closed = false;
	const closing = application.close().then(() => { closed = true; });
	await vi.waitFor(() => expect(messages).toHaveLength(1));
	expect(closed).toBe(false);
	finish();
	await closing;
	expect(closed).toBe(true);
});

it('sends an HTTP exception with request context through the Fastify child logger once', async () => {
	const { log, messages } = fixture();
	const server = Fastify({ loggerInstance: log.logger });
	try {
		registerHttpErrorHandler(server);
		server.get('/failure', async () => { throw new Error('HTTP test failure'); });
		const response = await server.inject('/failure?token=HIDDEN');
		expect(response.statusCode).toBe(500);
		await log.flush();
		expect(messages).toHaveLength(1);
		expect(messages[0].text).toContain('HTTP test failure');
		expect(messages[0].text).toContain('"requestMethod": "GET"');
		expect(messages[0].text).toContain('/failure');
		expect(messages[0].text).not.toContain('HIDDEN');
	} finally { await server.close(); }
});

it('respects disabled logging and runtime levels', async () => {
	const { log, messages } = fixture();
	log.level = 'silent'; log.error('Disabled');
	log.level = 'fatal'; log.error('Below level'); log.fatal('Enabled');
	await log.flush();
	expect(messages).toHaveLength(1);
});


it('independently routes files and multiple email destinations by their configured levels', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'db3-log-routes-'));
	const messages: ResolvedMailMessage[] = [];
	const mail = new Mail({ transport: { async send(message) {
		messages.push(message);
		return { id: String(messages.length), transport: 'test', accepted: [], rejected: [] };
	} } });
	const file = join(directory, 'records.jsonl');
	const log = new Log({ level: 'info', transports: [
		{ type: 'file', level: 'info', destination: file },
		{ type: 'email', level: 'error', to: 'errors@example.test' },
		{ type: 'email', level: 'fatal', to: 'fatal@example.test' },
		{ type: 'email', level: 'silent', to: 'disabled@example.test' },
	] }, () => mail);
	try {
		log.info('Progress'); log.warn('Warning'); log.error('Failure'); log.fatal('Stopped');
		await log.close();
		expect((await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line).msg)).toEqual(['Progress', 'Warning', 'Failure', 'Stopped']);
		expect(messages.filter(message => message.to[0] === 'errors@example.test')).toHaveLength(2);
		expect(messages.filter(message => message.to[0] === 'fatal@example.test')).toHaveLength(1);
		expect(messages).toHaveLength(3);
	} finally { await log.close(); await rm(directory, { recursive: true, force: true }); }
});

it('disables destinations when the explicit list is empty and rejects unsupported configuration', async () => {
	const log = new Log({ level: 'error', transports: [] });
	try { expect(log.level).toBe('silent'); log.error('No destination'); } finally { await log.close(); }
	expect(() => new Log({ transports: [{ type: 'email', to: 'operator@example.test' }] })).toThrow('Mail resolver');
	expect(() => new Log({ transports: [{ type: 'file', destination: '' }], level: 'info' })).toThrow('destination');
});
