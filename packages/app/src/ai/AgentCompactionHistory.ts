import type { AgentInputItem, ModelProvider, ModelRequest } from '@openai/agents';

/**
 * Preserves native compaction items that the SDK currently omits from RunResult.history.
 * Adapts the public model boundary without mutating SDK state. Observation happens
 * before the runner can start another call, independently of the stream consumer.
 */
export class AgentCompactionHistory {
	#inputLength = 0;
	#checkpoint: { item: AgentInputItem; through: number } | null = null;

	/** Keeps provider retry advice and request options while adapting context at each model call. */
	provider(provider: ModelProvider): ModelProvider {
		const history = this;
		return {
			/** Resolves the real provider model, retaining its cancellation and retry behavior. */
			async getModel(name) {
				const model = await provider.getModel(name);
				return {
					/** Preserves the same continuation semantics for non-streamed provider calls. */
					async getResponse(request) {
						const response = await model.getResponse(history.#request(request));
						history.#observe(response.output);
						return response;
					},
					/** Observes opaque output before yielding it to the SDK's tool loop. */
					async *getStreamedResponse(request) {
						for await (const event of model.getStreamedResponse(history.#request(request))) {
							if (event.type === 'response_done') history.#observe(event.response.output);
							yield event;
						}
					},
					...(model.getRetryAdvice ? { getRetryAdvice: model.getRetryAdvice.bind(model) } : {}),
				};
			},
		};
	}

	/** Records the unfiltered SDK boundary before supplying a smaller provider input. */
	#request(request: ModelRequest): ModelRequest {
		const input = typeof request.input === 'string' ? [{ role: 'user' as const, content: request.input }] : request.input;
		this.#inputLength = input.length;
		return { ...request, input: this.continuation(input) };
	}

	/** Retains the latest opaque provider item unchanged for this model run. */
	#observe(output: AgentInputItem[]): void {
		const item = [...output].reverse().find(item => item.type === 'compaction');
		if (item) this.#checkpoint = { item, through: this.#inputLength };
	}

	/** Keeps compacting-response outputs and later tool results, preserving pending call/result pairs. */
	continuation(input: AgentInputItem[]): AgentInputItem[] {
		if (!this.#checkpoint) return input;
		return [this.#checkpoint.item, ...input.slice(this.#checkpoint.through).filter(item => item.type !== 'compaction')];
	}
}
