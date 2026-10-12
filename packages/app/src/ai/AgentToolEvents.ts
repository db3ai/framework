import type { Runner, RunStreamEvent } from '@openai/agents';
import type { AgentEventSink, AgentStreamEvent } from './contracts/Agent';

/**
 * Records each SDK tool lifecycle independently of the parallel batch. Both SDK
 * hooks and replayed run items share one call identity and one awaited write.
 * Persistence failures abort this execution; listeners never leak rejections.
 */
export class AgentToolEvents {
	readonly #writes = new Map<string, Promise<void>>();
	readonly #stop = new AbortController();
	#closed = false;

	/** Uses the existing normalizers, persistence and stream sink for every tool. */
	constructor(readonly runner: Runner, readonly normalize: { calling(item: unknown): Promise<AgentStreamEvent | null>; output(item: unknown): Promise<AgentStreamEvent | null>; rawItem?(event: RunStreamEvent): { phase: 'calling' | 'output'; item: unknown } | null }, readonly emit: AgentEventSink) {
		runner.on('agent_tool_start', this.#start);
		runner.on('agent_tool_end', this.#end);
	}

	/** Stops this provider when a hook's asynchronous durable write fails. */
	get signal(): AbortSignal { return this.#stop.signal; }

	/** Receives SDK start notifications without depending on stream batch delivery. */
	readonly #start = (_context: unknown, _agent: unknown, _tool: unknown, details: { toolCall: unknown }): void => {
		if (this.#closed) return;
		void this.#record('calling', { rawItem: details.toolCall }).catch(() => undefined);
	};

	/** Receives final, guardrail-processed output as soon as each tool returns. */
	readonly #end = (_context: unknown, _agent: unknown, _tool: unknown, output: unknown, details: { toolCall: unknown }): void => {
		if (this.#closed) return;
		void this.#record('output', { rawItem: details.toolCall, output }).catch(() => undefined);
	};

	/** Deduplicates the SDK's later batch items against the same lifecycle writes. */
	async consume(event: RunStreamEvent): Promise<boolean> {
		const raw = this.normalize.rawItem?.(event);
		if (raw) { await this.#record(raw.phase, raw.item); return true; }
		if (event.type !== 'run_item_stream_event') return false;
		if (event.name === 'tool_called' || event.name === 'tool_search_called') {
			await this.#record('calling', event.item); return true;
		}
		if (event.name === 'tool_output' || event.name === 'tool_search_output_created') {
			await this.#record('output', event.item); return true;
		}
		return false;
	}

	/** Waits for all observed tool output before declaring the provider run complete. */
	async drain(): Promise<void> { await Promise.all(this.#writes.values()); }

	/** Detaches SDK listeners and drains existing writes even after an aborted run. */
	async close(): Promise<void> {
		this.#closed = true;
		this.runner.off('agent_tool_start', this.#start);
		this.runner.off('agent_tool_end', this.#end);
		await Promise.allSettled(this.#writes.values());
	}

	/** Orders each tool's start before its result without serializing unrelated tools. */
	#record(phase: 'calling' | 'output', item: unknown): Promise<void> {
		const raw = (item as { rawItem?: { callId?: string; call_id?: string; id?: string; name?: string } }).rawItem;
		const id = raw?.callId ?? raw?.call_id ?? raw?.id ?? raw?.name ?? 'unknown_tool';
		const key = `${phase}:${id}`;
		const existing = this.#writes.get(key);
		if (existing) return existing;
		// Rejected or guarded calls can deliver output without a start hook. A late
		// batch start must never replace their already recorded terminal state.
		if (phase === 'calling' && this.#writes.has(`output:${id}`)) return this.#writes.get(`output:${id}`)!;
		const start = phase === 'output' ? this.#writes.get(`calling:${id}`) : undefined;
		const write = Promise.resolve().then(async () => {
			await start;
			this.#stop.signal.throwIfAborted();
			const event = await this.normalize[phase](item);
			if (event) await this.emit(event);
		});
		this.#writes.set(key, write);
		void write.catch(error => this.#stop.abort(error));
		return write;
	}
}
