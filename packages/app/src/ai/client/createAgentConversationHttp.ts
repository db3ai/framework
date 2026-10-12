import type * as stream from '../contracts/AgentConversationStream';

/** Standard authenticated conversation route configuration; applications provide send separately. */
export interface AgentConversationHttpOptions {
	/** Conversation collection prefix, for example /api/agent/conversations. */
	baseUrl: string;
	view: stream.AgentView;
	/** Optional fetch boundary for framework hosts and deterministic tests. */
	fetch?: typeof fetch;
	/** Read at request time so session and organization changes take effect immediately. */
	headers?: () => NonNullable<Parameters<typeof fetch>[1]>['headers'];
}

/** Creates saved-history and stop adapters for the framework conversation HTTP routes. */
export function createAgentConversationHttp(options: AgentConversationHttpOptions): stream.AgentHttpAdapter {
	const baseUrl = options.baseUrl.replace(/\/$/, '');
	/** Reads ordinary JSON while retaining HTTP status for fail-closed authorization handling. */
	async function request<T>(id: string, path: string, signal: AbortSignal, method = 'GET'): Promise<T> {
		const response = await (options.fetch ?? fetch)(`${baseUrl}/${encodeURIComponent(id)}/${path}`, { method, headers: options.headers?.(), signal });
		if (!response.ok) throw Object.assign(new Error('Unable to access this conversation.'), { status: response.status });
		return await response.json() as T;
	}
	return {
		/** Loads stable messages and execution state using the selected authorized projection. */
		load: (id, signal) => request(id, `snapshot?${new URLSearchParams({ view: options.view })}`, signal),
		/** Uses the server's database-order cursor without inferring order from message IDs. */
		history: (id, before, signal) => request(id, `history?${new URLSearchParams({ view: options.view, before: String(before) })}`, signal),
		/** Stops the current conversation and its queued inputs, with no turn ID in the body. */
		stop: (input, signal) => request(input.conversationId, 'stop', signal, 'POST'),
	};
}
