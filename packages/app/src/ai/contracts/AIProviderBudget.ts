import type { AIProvider, AIRecordIdentity, AIUsageCharge } from './AI.js';
import type { AiRequest } from '../AiRequest.js';

/** Actual HTTP request boundary, including every SDK turn, fallback and retry. */
export interface AIProviderBudgetInput {
	/** HTTP endpoint pathname; compaction and generation can have different request controls. */
	endpoint?: string;
	provider: AIProvider;
	model: string;
	operation: string;
	aiRequest: AiRequest | null;
	rootAiRequest: AiRequest | null;
	user?: AIRecordIdentity | string | null;
	scope?: AIRecordIdentity | string | null;
	usage?: AIUsageCharge | null;
	/** Parsed outbound JSON. A reservation may lower output limits before dispatch. */
	request: Record<string, unknown>;
}

/** Provider result available for idempotent settlement, including known usage on failures. */
export interface AIProviderBudgetResult {
	status: number | null;
	/** Terminal response object for SSE; ordinary response object for JSON. */
	payload: Record<string, unknown> | null;
	/** Transport failure, cancellation or a stream without a terminal response. */
	uncertain: boolean;
}

/** App-owned durable hold. Settlement must tolerate cancellation and repeated delivery. */
export interface AIProviderBudgetReservation {
	/** Optional bounded replacement request, for example a reduced output-token ceiling. */
	request?: Record<string, unknown>;
	/** Run-wide deadline in addition to the normal per-request timeout and caller cancellation. */
	signal?: AbortSignal;
	/** Records actual usage or releases a definitely unused hold; never bills an estimate as actual. */
	settle(result: AIProviderBudgetResult): Promise<void>;
}

/** Reserves cumulative customer/provider capacity before any external HTTP request. Throw to deny dispatch. */
export type AIProviderBudgetHook = (input: AIProviderBudgetInput) => Promise<AIProviderBudgetReservation | null>;
