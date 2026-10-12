import { createAgentConversation, type AgentRealtimeAdapter } from '@db3.ai/app/ai/client';

/** App-owned HTTP routes and shared authenticated socket adapter for a help conversation. */
export interface HelpConversationClientOptions {
	/** Route prefix, such as /api/help/conversations. The app implements the endpoints below. */
	baseUrl: string;
	/** Current session and tenant headers; no provider credentials belong in the browser. */
	headers(): Record<string, string>;
	realtime: AgentRealtimeAdapter;
}

/** Creates an attachable conversation using ordinary JSON HTTP and the application's shared socket. */
export function createHelpConversationClient(options: HelpConversationClientOptions) {
	/** Reads typed JSON while preserving authorization status for automatic view cleanup. */
	async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
		const headers = new Headers(options.headers());
		if (body !== undefined) headers.set('content-type', 'application/json');
		const response = await fetch(`${options.baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
		if (!response.ok) throw Object.assign(new Error('Unable to access this conversation.'), { status: response.status });
		return await response.json() as T;
	}
	return createAgentConversation({ view: 'conversation', realtime: options.realtime, http: {
		/** The route authenticates, authorizes and calls HelpAgent.queue with this submission key. */
		send: (input, signal) => request('/send', signal, input),
		/** The route authenticates and calls conversations.stop with these exact turn identifiers. */
		stop: (input, signal) => request(`/${encodeURIComponent(input.conversationId)}/stop`, signal, { aiRequestId: input.aiRequestId }),
		/** Returns app().ai.conversations.load for the authenticated user and scope. */
		load: (id, signal) => request(`/${encodeURIComponent(id)}/snapshot`, signal),
		/** Returns app().ai.conversations.updates through the supplied fixed watermark. */
		updates: (after, through, signal) => request(`/${encodeURIComponent(after.conversationId)}/updates?${new URLSearchParams({ after: JSON.stringify(after), ...(through ? { through: JSON.stringify(through) } : {}) })}`, signal),
		/** Returns load({ before }) without transferring the whole conversation. */
		history: (id, before, signal) => request(`/${encodeURIComponent(id)}/history?before=${before}`, signal),
		/** Reads a large item only when the viewer explicitly opens it. */
		item: (id, itemId, offset, revision, signal) => request(`/${encodeURIComponent(id)}/item?${new URLSearchParams({ itemId, offset: String(offset), ...(revision ? { revision } : {}) })}`, signal),
	} });
}
