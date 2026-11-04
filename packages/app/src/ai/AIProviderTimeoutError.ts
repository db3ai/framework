/** Which provider time limit was reached. */
export type AIProviderTimeoutKind = 'response_start' | 'stream_idle' | 'total';

const TIMEOUT_CODES = {
	response_start: 'ai_provider_response_start_timeout',
	stream_idle: 'ai_provider_stream_idle_timeout',
	total: 'ai_provider_total_timeout',
} as const;

/** Stable code for each provider time limit, safe to retain in diagnostics and match in logs. */
export type AIProviderTimeoutCode = typeof TIMEOUT_CODES[AIProviderTimeoutKind];

/** Lists the timeout codes that diagnostics may keep. */
export const AI_PROVIDER_TIMEOUT_CODES: readonly string[] = Object.values(TIMEOUT_CODES);

/** Raised when a provider connection, stream or whole request exceeds its configured limit. */
export class AIProviderTimeoutError extends Error {
	readonly code: AIProviderTimeoutCode;

	/**
	 * Creates a failure naming the limit reached; contains no provider text.
	 *
	 * @param kind - Limit that was reached.
	 * @param timeoutMs - Configured limit in milliseconds.
	 */
	constructor(readonly kind: AIProviderTimeoutKind, readonly timeoutMs: number) {
		super(kind === 'response_start'
			? `AI provider did not start responding within ${formatDuration(timeoutMs)}.`
			: kind === 'stream_idle'
				? `AI provider stream stalled: no data received for ${formatDuration(timeoutMs)}.`
				: `AI provider request exceeded its overall limit of ${formatDuration(timeoutMs)}.`);
		this.name = 'AIProviderTimeoutError';
		this.code = TIMEOUT_CODES[kind];
	}
}

/** Writes a limit the way an operator would say it. */
function formatDuration(milliseconds: number): string {
	return milliseconds < 1000 ? `${milliseconds}ms` : `${Math.round(milliseconds / 100) / 10}s`;
}
