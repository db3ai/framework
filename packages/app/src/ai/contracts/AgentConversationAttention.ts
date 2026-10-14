/** Latest durable reason a conversation needs a reader's attention. Reading does not resolve an approval or input request. */
export interface AgentConversationAttention {
	/** Stable occurrence key; retries of the same occurrence preserve read state. */
	id: string;
	kind: 'completed' | 'failed' | 'blocked' | 'approval' | 'input';
	createdAt: string;
	/** Authorized readers who have seen this occurrence; replaced on the next occurrence. */
	readBy: string[];
}
