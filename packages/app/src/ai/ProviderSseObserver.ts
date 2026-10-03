/** Maximum retained decoded characters for one SSE line or joined data event. */
const MAX_EVENT_CHARACTERS = 1_048_576;

/**
 * Observes SSE framing without rewriting transport bytes or dispatching SDK events.
 * CR, LF and CRLF terminate lines; blank lines dispatch joined data fields. An
 * oversized event is discarded until its blank boundary, allowing later errors
 * to remain observable. Malformed or unfinished input permanently disqualifies
 * this observer from asserting recovery, even if a later event completes.
 */
export class ProviderSseObserver {
	#line = '';
	#lineNonempty = false;
	#skipLf = false;
	#data: string[] = [];
	#dataLength = 0;
	#eventOpen = false;
	#discardEvent = false;
	#valid = true;

	/** Receives complete joined data fields; the caller owns provider semantics. */
	constructor(readonly onData: (data: string) => Promise<void>) {}

	/** Records malformed JSON/encoding while continuing to observe later events. */
	invalidate(): void { this.#valid = false; }

	/** True only when every observed event is valid and ends at a blank boundary. */
	get complete(): boolean { return this.#valid && !this.#lineNonempty && !this.#eventOpen && !this.#discardEvent; }

	/** Consumes one decoded fragment; CRLF may be split between calls. */
	async push(text: string): Promise<void> {
		let start = 0;
		for (let index = 0; index < text.length; index++) {
			const character = text[index];
			if (this.#skipLf) {
				this.#skipLf = false;
				if (character === '\n') { start = index + 1; continue; }
			}
			if (character !== '\r' && character !== '\n') continue;
			this.#append(text.slice(start, index));
			await this.#finishLine();
			this.#skipLf = character === '\r';
			start = index + 1;
		}
		this.#append(text.slice(start));
	}

	/** Bounds retained line and event storage before adding another fragment. */
	#append(fragment: string): void {
		if (!fragment.length) return;
		this.#lineNonempty = true;
		if (this.#discardEvent) return;
		if (this.#line.length + this.#dataLength + fragment.length > MAX_EVENT_CHARACTERS) {
			this.invalidate();
			this.#discardEvent = true;
			this.#line = '';
			this.#data = [];
			this.#dataLength = 0;
		} else this.#line += fragment;
	}

	/** Dispatches only complete events, retaining SSE's joined-data semantics. */
	async #finishLine(): Promise<void> {
		const line = this.#line;
		const nonempty = this.#lineNonempty;
		this.#line = '';
		this.#lineNonempty = false;
		if (!nonempty) {
			const data = this.#discardEvent || !this.#data.length ? null : this.#data.join('\n');
			this.#data = [];
			this.#dataLength = 0;
			this.#eventOpen = false;
			this.#discardEvent = false;
			if (data !== null) await this.onData(data);
			return;
		}
		if (this.#discardEvent || line.startsWith(':')) return;
		this.#eventOpen = true;
		if (line !== 'data' && !line.startsWith('data:')) return;
		const data = line === 'data' ? '' : line.slice(line[5] === ' ' ? 6 : 5);
		this.#dataLength += data.length + 1;
		if (this.#dataLength > MAX_EVENT_CHARACTERS) {
			this.invalidate();
			this.#discardEvent = true;
			this.#data = [];
			this.#dataLength = 0;
		} else this.#data.push(data);
	}
}
