import type { AIProvider, AIProviderSelection } from './AI';

/**
 * Static connection settings for one OpenAI-compatible provider.
 *
 * Credentials and model defaults are resolved from environment variables by
 * convention so adding a provider is a single registry entry.
 */
export interface AIProviderConfig {
	/** Environment variable holding the provider API key. */
	apiKeyEnv: string;
	/** Environment variable overriding the provider base URL. */
	baseUrlEnv: string;
	/** Environment variable holding the provider default model, when provider-owned. */
	modelEnv: string | null;
	/** Public OpenAI-compatible base URL used when no override is set. */
	defaultBaseUrl: string;
	/** Whether the provider supports the OpenAI Responses API. Chat-completions-only providers can still run agents. */
	supportsResponsesApi: boolean;
}

/**
 * One resolved, fully configured provider attempt in a failover chain.
 */
export interface AIProviderAttempt {
	/** Stable provider id persisted on tracking rows and bucket keys. */
	provider: AIProvider;
	/** Model sent to this provider. */
	model: string;
	/** API key for this provider. */
	apiKey: string;
	/** OpenAI-compatible base URL without an endpoint suffix. */
	baseUrl: string;
	/** Whether this provider can serve OpenAI Responses API requests. */
	supportsResponsesApi: boolean;
}

/**
 * Sanitized record of one failed provider attempt stored on AiRequest metadata.
 */
export interface AIProviderAttemptFailure {
	/** Provider that failed. */
	provider: AIProvider;
	/** Model the failed attempt used. */
	model: string;
	/** HTTP status of the failure, when the provider responded. */
	status: number | null;
	/** Provider error code, when supplied. */
	code: string | null;
	/** Human-readable failure message. */
	message: string;
	/** Milliseconds spent on this attempt. */
	durationMs: number;
}

/**
 * OpenAI credentials resolved by the AI service from options and environment.
 */
export interface ResolvedOpenAIConnection {
	apiKey: string;
	baseUrl: string;
	model: string;
}

/**
 * Inputs needed to resolve a provider selection into ordered attempts.
 */
export interface ResolveProviderChainInput {
	/** Selection from the call or agent, or null for the OpenAI-only default. */
	selection: AIProviderSelection | null;
	/** OpenAI connection resolved by the AI service, including per-call model. */
	openai: ResolvedOpenAIConnection;
}
