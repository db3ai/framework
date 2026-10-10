import type { OutputChunk } from '../../shared/contracts.js';

/**
 * Raw terminal scrollback for one process, replayed into a terminal emulator
 * when a pane opens or reconnects.
 *
 * Keeps whole chunks as received (escape sequences intact) and drops the oldest
 * once the total passes `capacity` characters. Like a terminal's own
 * scrollback, a replay that starts mid-way may begin with a partial redraw.
 */
export class ScrollbackBuffer {
	private chunks: OutputChunk[] = [];
	private size = 0;
	private nextSeq = 1;

	/**
	 * @param capacity - Characters kept, about 1 MB by default.
	 */
	constructor(private readonly capacity = 1_000_000) {}

	/**
	 * Stores a chunk.
	 *
	 * @param data - Raw output.
	 * @returns The stored chunk.
	 */
	append(data: string): OutputChunk {
		const chunk = { seq: this.nextSeq++, data };
		this.chunks.push(chunk);
		this.size += data.length;
		while (this.size > this.capacity && this.chunks.length > 1) this.size -= this.chunks.shift()!.data.length;
		return chunk;
	}

	/**
	 * @param afterSeq - Return chunks with a greater `seq`; 0 for everything retained.
	 * @returns Chunks in order.
	 */
	since(afterSeq = 0): OutputChunk[] {
		return this.chunks.filter(chunk => chunk.seq > afterSeq);
	}

	/** Whether the retained output ends at the start of a line. */
	get atLineStart(): boolean {
		const last = this.chunks[this.chunks.length - 1]?.data;
		return !last || last.endsWith('\n');
	}

	/** Removes all retained output. Sequence numbers keep increasing. */
	clear(): void {
		this.chunks = [];
		this.size = 0;
	}
}
