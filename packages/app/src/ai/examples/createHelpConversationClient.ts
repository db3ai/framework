import { createAgentConversation, createAgentConversationHttp, type AgentRealtimeAdapter, type QueuedAgentRunResponse } from '@db3.ai/app/ai/client';

/** App-owned conversation routes and shared authenticated socket for a help conversation. */
export interface HelpConversationClientOptions {
	/** Route prefix, such as /api/help/conversations. */
	baseUrl: string;
	/** Current session and tenant headers; provider credentials never belong in the browser. */
	headers(): Record<string, string>;
	realtime: AgentRealtimeAdapter;
}

/** Connects shared history/reconnect/stop mechanics and one application-owned send endpoint. */
export function createHelpConversationClient(options: HelpConversationClientOptions) {
	const http = createAgentConversationHttp({ baseUrl: options.baseUrl, view: 'conversation', headers: options.headers });
	return createAgentConversation({ view: 'conversation', realtime: options.realtime, http: {
		...http,
		/** Authenticates and authorizes before calling HelpAgent.queue with this submission key. */
		send: async (input, signal) => {
			const response = await fetch(`${options.baseUrl}/send`, { method: 'POST', headers: { ...options.headers(), 'content-type': 'application/json' }, signal, body: JSON.stringify(input) });
			if (!response.ok) throw Object.assign(new Error('Unable to send this message.'), { status: response.status });
			return response.json() as Promise<QueuedAgentRunResponse>;
		},
	} });
}
