import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentPersistenceState } from './contracts/Agent';
import type { AIResponseLogOptions } from './contracts/AI';

/** Request-local parentage for provider calls made by tools or nested agents. */
export const aiExecutionContext = new AsyncLocalStorage<AgentPersistenceState>();

/** Inherits the active attempt without allowing nested work to create a second root debit. */
export function scopedAiOptions<T extends AIResponseLogOptions>(options: T, scopeField: string): T {
	const state = aiExecutionContext.getStore();
	if (!state) return options;
	return {
		conversation: state.conversation,
		parentAiRequest: state.aiRequest,
		user: state.aiRequest.user,
		[scopeField]: (state.aiRequest as unknown as Record<string, unknown>)[scopeField],
		...options,
	};
}
