import { describe, expect, it } from 'vitest';
import { PrettyLogFormatter } from '../PrettyLogFormatter';

const base = { level: 30, source: 'api', pid: 10, time: new Date(2026, 8, 27, 14, 50).getTime() };

/** Starts a captured HTTP request with predictable clock and payload context. */
function start(formatter: PrettyLogFormatter, reqId: string, now = 0): void {
	formatter.format({ ...base, reqId, req: { method: 'POST', url: `/${reqId}` }, msg: 'incoming request' }, now);
	formatter.format({ ...base, reqId, msg: 'request exchange', httpExchange: { request: { body: { kind: 'json', value: { user: reqId } } }, response: { body: { kind: 'json', value: { saved: reqId } } } } }, now);
}

describe('PrettyLogFormatter', () => {
	it('pairs overlapping requests with their own bodies in completion order', () => {
		const formatter = new PrettyLogFormatter();
		start(formatter, 'one'); start(formatter, 'two');
		expect(formatter.pending(1200)).toEqual(['[http] POST → /one  waiting · 1.2 s  #one', '[http] POST → /two  waiting · 1.2 s  #two']);
		const second = formatter.format({ ...base, reqId: 'two', res: { statusCode: 201 }, responseTime: 12.34, msg: 'request completed' });
		expect(second).toContain('14:50:00 [http] POST → /two  201 Created · 12 ms  #two');
		expect(second).toContain('> request\n    { "user": "two" }');
		expect(second).toContain('< response\n    { "saved": "two" }');
		expect(second).not.toContain('one');
		expect(formatter.pending(5000)).toEqual(['[http] POST → /one  slow · waiting · 5.0 s  #one']);
		const first = formatter.format({ ...base, reqId: 'one', res: { statusCode: 503 }, msg: 'request completed' });
		expect(first).toContain('503 Service Unavailable');
		expect(first).toContain('"saved": "one"');
		expect(formatter.pending()).toEqual([]);
	});

	it('keeps identical IDs from separate processes isolated and finalizes only an exited source', () => {
		const formatter = new PrettyLogFormatter();
		start(formatter, 'one');
		formatter.format({ ...base, pid: 20, reqId: 'one', req: { method: 'GET', url: '/other' }, msg: 'incoming request' });
		expect(formatter.finish(10)).toContain('POST → /one');
		expect(formatter.pending()[0]).toContain('GET → /other');
		expect(formatter.finish()).toContain('process stopped before response');
		expect(formatter.pending()).toEqual([]);
	});

	it.each(['request aborted', 'request timed out', 'request errored'])('removes pending work on %s without implying success', message => {
		const formatter = new PrettyLogFormatter();
		start(formatter, 'one');
		expect(formatter.format({ ...base, reqId: 'one', msg: message })).toMatch(/cancelled|timed out|failed/);
		expect(formatter.pending()).toEqual([]);
		expect(formatter.format({ ...base, reqId: 'one', msg: 'request completed', res: { statusCode: 200 } })).toBe('');
	});

	it('retains warnings, error causes and context while stripping terminal controls', () => {
		const formatter = new PrettyLogFormatter();
		const text = formatter.format({ level: 50, msg: '\u001b[31mJob failed', jobId: 'job-1', err: { stack: 'Error: unavailable\n    at run (worker.ts:12:3)', cause: { message: 'connection refused' } } });
		expect(text).toContain('[error] Job failed');
		expect(text).toContain('jobId=job-1');
		expect(text).toContain('at run (worker.ts:12:3)');
		expect(text).toContain('Caused by: Error: connection refused');
		expect(text).not.toContain('\u001b');
		expect(new PrettyLogFormatter(true).format({ level: 40, msg: 'Slow' })).toContain('\u001b[33m[warn]');
	});

	it('explicitly bounds arrays, long lines and captured bodies while preserving scalar JSON', () => {
		const formatter = new PrettyLogFormatter();
		const render = (body: object) => formatter.format({ ...base, msg: 'request exchange', httpExchange: { response: { statusCode: 200, body } } });
		expect(render({ kind: 'json', value: Array.from({ length: 100 }, (_, id) => ({ id })) })).toContain('more lines');
		expect(render({ kind: 'text', value: 'x'.repeat(1000), truncated: true, sizeBytes: 2000 })).toContain('line shortened');
		expect(render({ kind: 'text', value: 'partial', truncated: true, sizeBytes: 2000 })).toContain('capture truncated (2000 bytes');
		for (const value of [false, 0, null, 'hello']) expect(render({ kind: 'json', value })).toContain(JSON.stringify(value));
		expect(render({ kind: 'stream', note: 'Streaming response body omitted.' })).toContain('Streaming response body omitted.');
	});

	it('bounds abandoned requests, reports eviction, and handles missing arrival context', () => {
		const formatter = new PrettyLogFormatter();
		let last = '';
		for (let index = 0; index <= 1000; index++) last = formatter.format({ ...base, msg: 'incoming request', reqId: index, req: { method: 'GET', url: `/path-${index}` } });
		expect(last).toContain('tracking limit reached');
		expect(formatter.pending()).toHaveLength(1000);
		expect(formatter.format({ ...base, msg: 'request completed', reqId: 0, res: { statusCode: 404 }, time: 'invalid' })).toContain('--:--:-- [http] Request  404');
	});
});

describe('queue message colours', () => {
	const queueBase = { ...base, component: 'queue-worker' };

	it('colours state verbs and job labels when colouring is on', () => {
		const formatter = new PrettyLogFormatter(true);
		const claimed = formatter.format({ ...queueBase, msg: '[queue] Claimed CollectKeywordRanksJob#5249 on "default" attempt 1/3.' });
		expect(claimed).toContain('[queue] \u001b[34mClaimed\u001b[0m \u001b[1;35mCollectKeywordRanksJob#5249\u001b[0m on "default"');
		expect(formatter.format({ ...queueBase, msg: '[queue] Processed CollectKeywordRanksJob#5249 on "default".' })).toContain('\u001b[32mProcessed\u001b[0m');
		expect(formatter.format({ ...queueBase, msg: '[queue] Released SyncJob#7 after attempt 1/3; retrying in 5s.' })).toContain('\u001b[33mReleased\u001b[0m');
		expect(formatter.format({ ...queueBase, level: 50, msg: '[queue] Failed SyncJob#7 after 3/3 attempts.' })).toContain('\u001b[31mFailed\u001b[0m');
		expect(formatter.format({ ...queueBase, msg: '[queue] Worker started for "default".' })).toContain('[queue] Worker started for "default".');
	});

	it('leaves messages plain without colour', () => {
		const formatter = new PrettyLogFormatter();
		expect(formatter.format({ ...queueBase, msg: '[queue] Claimed CollectKeywordRanksJob#5249 on "default" attempt 1/3.' })).toContain('[queue] Claimed CollectKeywordRanksJob#5249 on "default" attempt 1/3.');
	});
});
