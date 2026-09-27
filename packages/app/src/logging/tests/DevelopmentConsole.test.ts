import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentConsole } from '@db3.ai/app/logging';

const owners: DevelopmentConsole[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.close(); vi.useRealTimers(); });

/** Captures terminal writes without touching the test runner's own stdout. */
function create(interactive = true, columns = 100) {
	let text = '';
	const output = Object.assign(new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } }), { isTTY: interactive, columns, rows: 24 });
	const owner = new DevelopmentConsole({ output, interactive, color: false });
	owners.push(owner);
	return { owner, output, take: () => { const result = text; text = ''; return result; } };
}

/** Serializes the minimum real Pino/Fastify arrival shape. */
function incoming(id = '1'): string { return JSON.stringify({ level: 30, pid: 1, reqId: id, msg: 'incoming request', req: { method: 'GET', url: `/user/${id}` } }); }

describe('DevelopmentConsole', () => {
	it('immediately renders pending work, advances its clock and removes it on completion', async () => {
		vi.useFakeTimers();
		const { owner, take } = create();
		owner.write(incoming());
		expect(take()).toContain('[http] GET -> /user/1  waiting');
		vi.advanceTimersByTime(1250);
		expect(take()).toContain('1.3 s');
		owner.write(JSON.stringify({ level: 30, pid: 1, reqId: '1', msg: 'request completed', res: { statusCode: 200 }, responseTime: 1250 }));
		const completed = take();
		expect(completed).toContain('\u001b[1A\r\u001b[J');
		expect(completed).toContain('200 OK · 1250 ms');
		expect(completed).not.toContain('waiting');
		owner.close();
		vi.advanceTimersByTime(1000);
		expect(take()).toBe('');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('coordinates tool output, limits pending rows and never clears the whole terminal', () => {
		const { owner, take, output } = create();
		for (let id = 0; id < 9; id++) owner.write(incoming(String(id)));
		take();
		owner.writeText('\u001b[2J\u001b[H Vite ready\n');
		const rendered = take();
		expect(rendered).toContain('Vite ready\n[http]');
		expect(rendered).toContain('5 more requests waiting');
		expect(rendered).not.toMatch(/\u001b\[2J|\u001b\[H/);
		output.columns = 30;
		output.emit('resize');
		const resized = take();
		for (const line of resized.split('\n').filter(line => line.startsWith('[http]'))) expect(line.length).toBeLessThan(30);
	});

	it('handles partial UTF-8 and final lines independently across child streams', async () => {
		const { owner, take } = create(false);
		const first = owner.createInput();
		const second = owner.createInput();
		const bytes = Buffer.from('Vite café\n');
		first.write(bytes.subarray(0, 9));
		second.end('Other child\n');
		first.end(bytes.subarray(9));
		await owner.flush();
		expect(take()).toBe('Other child\nVite café\n');
	});

	it('uses append-only grouped output off-terminal and clears pending work on close', () => {
		const { owner, take } = create(false);
		owner.write(incoming());
		expect(take()).toBe('');
		owner.close();
		const final = take();
		expect(final).toContain('interrupted');
		expect(final).not.toContain('\u001b');
	});
});
