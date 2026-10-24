import { afterEach, expect, it, vi } from 'vitest';
import { Mail } from '../../mail';
import { EmailLogTransport } from '../transports/EmailLogTransport';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('bounds pending messages before formatting a stalled-provider burst and admits later work', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let deliveries = 0;
	const mail = new Mail({ transport: { async send() {
		deliveries += 1;
		await gate;
		return { id: String(deliveries), transport: 'test', accepted: ['ops@example.test'], rejected: [] };
	} } });
	const transport = new EmailLogTransport({ to: 'ops@example.test', maxPending: 3, maxPerMinute: 100 }, () => mail);
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	try {
		for (let index = 0; index < 25_000; index++) transport.write(JSON.stringify({ level: 50, msg: 'Failure', index }));
		await Promise.resolve();
		expect(deliveries).toBe(1);
	} finally { release(); await transport.flush(); }
	expect(deliveries).toBe(3);
	transport.write(JSON.stringify({ level: 50, msg: 'Later failure' }));
	await transport.flush();
	expect(deliveries).toBe(4);
});

it('renews the delivery budget after one minute and rejects invalid admission limits', async () => {
	vi.useFakeTimers();
	let deliveries = 0;
	const mail = new Mail({ transport: { async send() {
		deliveries += 1;
		return { id: String(deliveries), transport: 'test', accepted: ['ops@example.test'], rejected: [] };
	} } });
	const transport = new EmailLogTransport({ to: 'ops@example.test', maxPerMinute: 2 }, () => mail);
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	for (let index = 0; index < 3; index++) transport.write('{"level":50,"msg":"Failure"}');
	await transport.flush();
	expect(deliveries).toBe(2);
	vi.advanceTimersByTime(60_000);
	transport.write('{"level":50,"msg":"Later failure"}');
	await transport.flush();
	expect(deliveries).toBe(3);
	expect(() => new EmailLogTransport({ to: 'ops@example.test', maxPending: 0 }, () => mail)).toThrow('positive integers');
});
