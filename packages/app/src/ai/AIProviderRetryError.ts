import { safeProviderCode, safeProviderRequestId, safeProviderStatus } from './providerFailureDiagnostics';

/** Retryable failure confined to one provider request; never defers unrelated work or bypasses queue attempt limits. */
export class AIProviderRetryError extends Error {
	readonly providerStarted = true;
	readonly providerCode: string | null;
	readonly diagnostics: { status: number | null; requestId: string | null };

	/** Carries bounded retry timing and allowlisted diagnostics without retaining a provider payload. */
	constructor(readonly retryAfterMs: number, providerCode: string | null = null, diagnostics: { status?: number | null; requestId?: string | null } = {}) {
		super('AI provider temporarily unavailable for this request.');
		this.name = 'AIProviderRetryError';
		this.providerCode = safeProviderCode(providerCode);
		this.diagnostics = { status: safeProviderStatus(diagnostics.status), requestId: safeProviderRequestId(diagnostics.requestId) };
	}
}
