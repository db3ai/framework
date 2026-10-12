import { QueueTerminalError } from '@db3.ai/app/queue';
import { safeProviderCode, safeProviderRequestId, safeProviderStatus } from './providerFailureDiagnostics';

/** Terminal failure of this run only; no persistent provider or account block is created. */
export class AIProviderStoppedError extends QueueTerminalError {
	readonly code = 'ai_provider_stopped';
	readonly providerCode: string | null;
	readonly status: number | null;
	readonly requestId: string | null;
	readonly stopStage: 'quota' | 'stream-output';
	providerStarted = false;

	/** Stops exhausted-credit work or unsafe replay after output, retaining only safe provider diagnostics. */
	constructor(readonly reason: 'quota' | 'outage', providerCode: string | null = null, diagnostics: { status?: number | null; requestId?: string | null; stopStage?: 'stream-output' } = {}) {
		super(reason === 'quota' ? 'AI provider credits exhausted; this run stopped.' : 'AI provider interrupted after streamed output; this run stopped to prevent unsafe replay.');
		this.name = 'AIProviderStoppedError';
		this.providerCode = safeProviderCode(providerCode);
		this.status = safeProviderStatus(diagnostics.status);
		this.requestId = safeProviderRequestId(diagnostics.requestId);
		this.stopStage = diagnostics.stopStage ?? (reason === 'quota' ? 'quota' : 'stream-output');
		this.providerStarted = true;
	}
}
