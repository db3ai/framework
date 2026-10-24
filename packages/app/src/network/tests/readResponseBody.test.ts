import { describe, expect, it } from 'vitest';
import { readResponseBytes, readResponseText } from '../readResponseBody';

describe('bounded response consumption', () => {
	it('preserves UTF-8 split across chunks and permits the exact byte budget', async () => {
		const bytes = new TextEncoder().encode('A😀Z');
		const response = new Response(new ReadableStream({ start(controller) {
			controller.enqueue(bytes.slice(0, 3));
			controller.enqueue(bytes.slice(3));
			controller.close();
		} }));
		expect(await readResponseText(response, bytes.byteLength)).toBe('A😀Z');
		expect(await readResponseBytes(new Response(null), 10)).toHaveLength(0);
	});

	it('cancels an oversized stream even when its declared length is small', async () => {
		let cancelled = false;
		let chunks = 0;
		const response = new Response(new ReadableStream({
			pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(8)); },
			cancel() { cancelled = true; },
		}), { headers: { 'content-length': '1' } });
		await expect(readResponseBytes(response, 16)).rejects.toThrow('16-byte limit');
		expect(cancelled).toBe(true);
		expect(chunks).toBeLessThanOrEqual(4);
	});

	it('rejects a declared oversized body before consuming it', async () => {
		const response = new Response('large', { headers: { 'content-length': '5000' } });
		await expect(readResponseText(response, 10)).rejects.toThrow('10-byte limit');
		expect(response.body?.locked).toBe(false);
	});

	it.each([0, -1, 1.5, Infinity])('rejects an invalid byte budget %s', async limit => {
		await expect(readResponseBytes(new Response('body'), limit)).rejects.toThrow('positive integer');
	});
});
