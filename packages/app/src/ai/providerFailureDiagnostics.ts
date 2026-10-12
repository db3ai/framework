/** Retains only recognized rejection codes, never arbitrary provider-supplied text. */
export function safeProviderCode(value: string | null): string | null {
	return value !== null && ['insufficient_quota', 'billing_hard_limit_reached', 'credit_balance_exhausted', 'server_error', 'service_unavailable', 'overloaded', 'overloaded_error', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(value) ? value : null;
}

/** Reports rejection HTTP status; a successful SSE handshake is not a rejection status. */
export function safeProviderStatus(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

/** Bounds opaque support identifiers and rejects whitespace, headers and arbitrary messages. */
export function safeProviderRequestId(value: unknown): string | null {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}
