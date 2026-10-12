import { AgentConversationClient, type AgentConversationClientOptions } from './AgentConversationClient';

/** Creates an HTTP-first viewer using application-owned HTTP and shared WebSocket adapters. */
export function createAgentConversation(options: AgentConversationClientOptions): AgentConversationClient { return new AgentConversationClient(options); }
