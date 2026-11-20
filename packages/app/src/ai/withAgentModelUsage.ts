import { Usage, type Model } from '@openai/agents';

/**
 * Adapts provider token details to the Agents SDK's numeric usage contract.
 * Nested provider breakdowns stay in raw provider data; their numeric parent
 * counts remain authoritative for billing. Normalization happens before the
 * runner validates completed stream events and also covers buffered responses.
 * The adapter neither buffers streams nor retries provider work.
 */
export function withAgentModelUsage(model: Model): Model {
	return {
		/** Retains SDK usage instances and response metadata for buffered calls. */
		async getResponse(request) {
			const response = await model.getResponse(request);
			return { ...response, usage: numericUsage(response.usage) };
		},
		/** Forwards events as they arrive, normalizing only completed usage. */
		async *getStreamedResponse(request) {
			for await (const event of model.getStreamedResponse(request)) {
				yield event.type === 'response_done'
					? { ...event, response: { ...event.response, usage: numericUsage(event.response.usage) } }
					: event;
			}
		},
		...(model.getRetryAdvice ? { getRetryAdvice: model.getRetryAdvice.bind(model) } : {}),
	};
}

/** Copies usage without changing totals, endpoint identities or provider-owned objects. */
function numericUsage(input: ConstructorParameters<typeof Usage>[0]): Usage {
	const usage = new Usage(input);
	return new Usage({
		...usage,
		inputTokensDetails: usage.inputTokensDetails.map(numericDetails),
		outputTokensDetails: usage.outputTokensDetails.map(numericDetails),
		requestUsageEntries: usage.requestUsageEntries?.map(entry => ({
			...entry,
			inputTokensDetails: numericDetails(entry.inputTokensDetails),
			outputTokensDetails: numericDetails(entry.outputTokensDetails),
		})),
	});
}

/** Keeps finite scalar counters without flattening or double-counting nested subtotals. */
function numericDetails(details: Record<string, number>): Record<string, number> {
	return Object.fromEntries(Object.entries(details).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
}
