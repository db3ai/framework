import type { OutputChunk } from '../../shared/contracts.js';

/**
 * Merges raw terminal chunks into a process's client-side scrollback.
 *
 * Chunks arrive from both the initial fetch and the live event stream, in
 * either order, so they are de-duplicated by `seq` and kept in order. The
 * oldest are dropped once the total passes `capacity` characters.
 *
 * @param current - Chunks already held.
 * @param incoming - New chunks.
 * @param capacity - Characters kept.
 * @returns A new array, or `current` when nothing changed.
 */
export function mergeChunks(current: OutputChunk[], incoming: OutputChunk[], capacity = 1_000_000): OutputChunk[] {
	if (!incoming.length) return current;
	const last = current.length ? current[current.length - 1]!.seq : 0;
	let next: OutputChunk[];
	if (incoming.every(chunk => chunk.seq > last)) {
		next = current.concat(incoming);
	} else {
		const bySeq = new Map<number, OutputChunk>();
		for (const chunk of current) bySeq.set(chunk.seq, chunk);
		for (const chunk of incoming) bySeq.set(chunk.seq, chunk);
		next = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
	}
	let size = next.reduce((total, chunk) => total + chunk.data.length, 0);
	let start = 0;
	while (size > capacity && start < next.length - 1) size -= next[start++]!.data.length;
	return start ? next.slice(start) : next;
}
