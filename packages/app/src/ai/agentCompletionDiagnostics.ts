/** Bounded, payload-free evidence from one SDK provider execution attempt. */
export interface AgentCompletionDiagnostics {
	/** Number of observed terminal model responses, including tool turns. */
	modelTurns: number;
	/** Last terminal response's allowlisted provider status; null when unavailable. */
	terminalStatus: string | null;
	/** Last response's allowlisted incomplete reason; unknown values are not copied. */
	incompleteReason: string | null;
	/** Number of persisted tool start, success and error events in this attempt. */
	toolCalls: number;
	toolSuccesses: number;
	toolErrors: number;
}

/** Creates independent counters for each provider attempt, including queued retries. */
export function createAgentCompletionDiagnostics(): AgentCompletionDiagnostics {
	return { modelTurns: 0, terminalStatus: null, incompleteReason: null, toolCalls: 0, toolSuccesses: 0, toolErrors: 0 };
}

/**
 * Records only known terminal status/reason values; never copies provider prose.
 * Missing metadata stays null and an unrecognized supplied value becomes unknown.
 */
export function recordAgentCompletion(diagnostics: AgentCompletionDiagnostics, providerData: Record<string, unknown> | null): void {
	diagnostics.modelTurns++;
	diagnostics.terminalStatus = allowlistedValue(providerData?.status, ['completed', 'incomplete', 'failed', 'cancelled']);
	const details = providerData?.incomplete_details;
	diagnostics.incompleteReason = allowlistedValue(details && typeof details === 'object' && 'reason' in details ? details.reason : null, ['max_output_tokens', 'content_filter']);
}

/** Maps untrusted metadata to fixed symbols without retaining arbitrary strings. */
function allowlistedValue(value: unknown, allowed: string[]): string | null {
	if (value === undefined || value === null) return null;
	return typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
}
