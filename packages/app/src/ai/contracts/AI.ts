import type { AIServiceTier } from './AIServiceTier';
import type { TextResponsePayload } from '@db3.ai/pure';
import type { ZodType } from 'zod';
import type { AiConversation } from '../AiConversation.js';
import type { AiRequest } from '../AiRequest.js';
import type { AiRateLimitEndpoint } from '../AiRateLimitBucket.js';
import type { AIRateLimiter } from '../AIRateLimiter.js';

/**
 * Provider identifiers stored with AI requests and conversation messages.
 *
 * Every provider must expose an OpenAI-compatible API. Keep these values stable
 * because they are persisted in tracking tables and rate-limit bucket keys.
 */
export const AI_PROVIDER = {
	openai: 'openai',
	openrouter: 'openrouter',
	groq: 'groq',
	xai: 'xai',
	deepseek: 'deepseek',
} as const;

/**
 * Supported AI provider id.
 */
export type AIProvider = typeof AI_PROVIDER[keyof typeof AI_PROVIDER];

/**
 * Application-owned AI model configuration.
 *
 * `model` is the global fallback. Additional keys are stable runtime names,
 * such as concrete agent class names, resolved through `AI.config(...)`.
 */
export interface AIConfig {
	/** Global model used when a call or agent does not select its own model. */
	model: string;

	/** Named model override or the required global model. */
	[name: string]: string;
}

/**
 * Ordered provider selection for a call, an agent, or the app default.
 *
 * A single provider keeps normal single-provider behavior. An ordered list
 * fails over to the next provider using each provider's default model. An
 * ordered record pins a model per provider and preserves insertion order:
 *
 * ```ts
 * provider: [AI_PROVIDER.openai, AI_PROVIDER.openrouter]
 * provider: {
 * 	[AI_PROVIDER.openai]: 'gpt-5.4-mini',
 * 	[AI_PROVIDER.openrouter]: 'comparable-mini-model',
 * }
 * ```
 */
export type AIProviderSelection =
	| AIProvider
	| AIProvider[]
	| Partial<Record<AIProvider, string>>;

/** Explicit application credit charge attached to one AI provider operation. */
export interface AIUsageCharge {
	/** Independent credit bucket selected by the feature starting the operation. */
	bucket: string;

	/** Positive whole-credit amount consumed before provider work begins. */
	credits: number;

	/**
	 * Optional caller-owned key for one logical usage charge.
	 *
	 * Supply this when queue retries or other re-executions can create more than
	 * one tracked AI request for the same billable operation. When omitted, the
	 * allowance adapter derives its key from the tracked AI request.
	 */
	idempotencyKey?: string;
}

/**
 * Context passed to an application-owned customer allowance hook.
 *
 * This hook is separate from provider rate limits. Provider limits answer "can
 * this API key call OpenAI right now"; allowance checks answer "is this user,
 * scope, team, or customer allowed to spend more application AI budget".
 */
export interface AIAllowanceCheckInput {
	/** Provider that will receive the request. */
	provider: AIProvider;
	/** Provider endpoint family, such as responses or embeddings. */
	endpoint: AiRateLimitEndpoint;
	/** Provider model or shared limit key used by the request. */
	model: string;
	/** Logical app operation, such as responses.create or agents.run.stream. */
	operation: string;
	/** User record or id associated with this request. */
	user?: AIRecordIdentity | string | null;
	/** Scope record or id associated with this request. */
	scope?: AIRecordIdentity | string | null;
	/** Pending tracked request row, when one has already been created. */
	aiRequest?: AiRequest | null;
	/** Estimated token cost used for pre-flight decisions. */
	estimatedTokens?: number | null;
	/** Explicit app credit charge, or null for unmetered and separately funded work. */
	usage?: AIUsageCharge | null;
	/** Extra operation metadata for policy decisions and audit messages. */
	metadata?: Record<string, unknown> | null;
}

/**
 * Application-defined allowance checker.
 *
 * Throw an app-level error from this hook to stop a request before provider
 * capacity is reserved or external work starts.
 */
export type AIAllowanceChecker = (input: AIAllowanceCheckInput) => void | Promise<void>;

/**
 * Runtime configuration for the AI service.
 *
 * Values supplied here override environment variables, which makes the service
 * easy to test with a fake fetch implementation or alternate API endpoint.
 */
export interface AIOptions {
	/** Maximum duration of each provider HTTP request, including SDK model turns. */
	timeoutMs?: number;
	/** Persisted logical scope field. Apps may map this to an existing domain field. */
	scopeField?: string;
	/** Model subclasses registered by the application migration workflow. */
	models?: Partial<AIModels>;

	/** OpenAI API key. Falls back to OPENAI_API_KEY when omitted. */
	apiKey?: string;
	/** Base API URL without the /responses suffix. Falls back to OPENAI_BASE_URL. */
	baseUrl?: string;
	/** Model name to use instead of the application config default. */
	model?: string;
	/** Default provider failover chain. Falls back to AI_PROVIDER_CHAIN, then OpenAI only. */
	provider?: AIProviderSelection;
	/** Fetch implementation used to send requests. Defaults to global fetch. */
	fetch?: typeof fetch;
	/** Rate limiter used before provider requests. Pass false only in isolated tests. */
	rateLimiter?: AIRateLimiter | false;
	/** Durable account admission policy; capacity limiter disabling never bypasses it. */
	providerAdmission?: import('../AIProviderAdmission').AIProviderAdmissionOptions;
	/** Optional customer allowance hook. Defaults to no-op until billing limits exist. */
	allowance?: AIAllowanceChecker | false;
}

/**
 * Plain text request sent to the Responses API.
 */
export interface GenerateTextInput {
	/** Keep transient failures local to optional work; account quota and existing admission stops still apply. */
	transientFailureScope?: 'account' | 'request';
	/** Explicit OpenAI processing tier; defaults to Standard. No automatic tier fallback. */
	serviceTier?: AIServiceTier;
	/** Optional per-call model override for the OpenAI provider entry. */
	model?: string;
	/** Optional provider failover chain overriding the app default for this call. */
	provider?: AIProviderSelection;
	/** System-level instructions that define the assistant's task and constraints. */
	instructions: string;
	/** User-level prompt or context for the request. */
	input: string;
	/** Optional maximum response tokens sent as max_output_tokens. */
	maxOutputTokens?: number;
}

/**
 * Text generation result with optional database tracking identifiers.
 */
export interface GenerateTextResult {
	/** Extracted assistant text from the Responses API payload. */
	text: string;
	/** Saved AiRequest id when response logging is enabled; otherwise null. */
	aiRequestId: string | null;
	/** Saved response id. Currently mirrors aiRequestId because responses live on AiRequest. */
	aiResponseId: string | null;
	/** Conversation id used for tracked request and message rows; otherwise null. */
	conversationId: string | null;
}

/**
 * Embedding generation result with optional database tracking identifier.
 */
export interface GenerateEmbeddingResult {
	/** Embedding vector returned by the provider. */
	vector: number[];
	/** Embedding model used for the request. */
	model: string;
	/** Saved AiRequest id when response logging is enabled; otherwise null. */
	aiRequestId: string | null;
}

/**
 * Structured generation request that asks the provider to return JSON matching
 * a Zod schema and validates the parsed result before returning it.
 */
export interface GenerateStructuredInput<TValue> extends GenerateTextInput {
	/** Schema used both for provider response formatting and local validation. */
	schema: ZodType<TValue>;
	/** Stable schema name sent to OpenAI and stored in request metadata. */
	schemaName: string;
}

/**
 * Optional metadata that controls how AI requests are attached to application
 * records when response logging is enabled.
 */
export interface AIResponseLogOptions extends Record<string, unknown> {
	/** User record or id to associate with the request. Defaults to the active user. */
	user?: AIRecordIdentity | string | null;
	/** Scope record or id to associate with the request. */
	scope?: AIRecordIdentity | string | null;
	/** Existing conversation record or id to append to. Creates a new conversation when omitted. */
	conversation?: AiConversation | string | null;
	/** Immediate parent AI request that caused this nested provider request. */
	parentAiRequest?: AiRequest | string | null;
	/** Logical feature or agent name shown on the conversation/request. */
	agent?: string | null;
	/** Human-readable conversation title when a new conversation is created. */
	title?: string | null;
	/** Extra JSON metadata copied to the conversation, request, and message rows. */
	metadata?: Record<string, unknown> | null;
	/** Explicit app credit charge checked before provider work begins. */
	usage?: AIUsageCharge | null;
	/** Set to false to opt out of saving request, response, and message rows. */
	saveAiResponse?: boolean;
}

/** Untrusted provider text response, including optional token usage. */
export interface TextResponsePayloadWithUsage extends TextResponsePayload {
	/** Actual model reported by the provider for billing. */
	model?: unknown;
	/** Actual processing tier reported by OpenAI, not the requested tier. */
	service_tier?: unknown;
	/** Provider completion status; omitted by some compatible endpoints. */
	status?: unknown;
	usage?: unknown;
}

/** Untrusted embedding response validated by the AI service before it is returned. */
export interface EmbeddingResponsePayloadWithUsage {
	data?: Array<{
		embedding?: unknown;
		index?: unknown;
		object?: unknown;
	}>;
	model?: unknown;
	object?: unknown;
	usage?: unknown;
	error?: unknown;
}

/**
 * Image generation request sent to the provider Images API.
 */
export interface GenerateImageInput {
	/** Optional per-call model override. Defaults to the `ImageGeneration` AI config entry. */
	model?: string;
	/** Detailed image prompt. */
	prompt: string;
	/** Provider image size, such as 1024x1024 or 1536x1024. */
	size?: string;
	/** Provider image quality, such as low, medium, high, or auto. */
	quality?: string;
	/** Provider image output format. Defaults to png. */
	outputFormat?: 'png' | 'jpeg' | 'webp';
	/** Provider end-user id forwarded to OpenAI, when available. */
	user?: string | null;
}

/**
 * Provider Images API response shape used by the AI service.
 */
export interface ImageResponsePayloadWithUsage {
	created?: unknown;
	data?: Array<{
		b64_json?: unknown;
		revised_prompt?: unknown;
		url?: unknown;
	}>;
	error?: unknown;
	usage?: unknown;
}

/**
 * Image bytes and tracking context passed to a storage callback.
 */
export interface GenerateImageStoreInput {
	/** Base64-encoded image bytes returned by the provider. */
	b64Json: string;
	/** Tracked request row, when request logging is enabled. */
	aiRequest: AiRequest | null;
	/** Tracked request id, when request logging is enabled. */
	aiRequestId: string | null;
	/** Provider model used for this image. */
	model: string;
	/** Prompt sent to the provider. */
	prompt: string;
	/** Image size sent to the provider. */
	size: string | null;
	/** Image quality sent to the provider. */
	quality: string | null;
	/** Image output format sent to the provider. */
	outputFormat: string;
	/** Compact provider response without raw image bytes. */
	providerResponse: Record<string, unknown> | null;
}

/**
 * Stores generated image bytes and returns the app-owned storage reference.
 */
export type GenerateImageStoreCallback<TStored> = (input: GenerateImageStoreInput) => TStored | Promise<TStored>;

/**
 * Optional metadata and storage callback for image generation.
 */
export interface GenerateImageOptions<TStored = unknown> extends RequestLogOptions {
	/** Saves generated image bytes and returns the value stored on AiRequest.response. */
	store?: GenerateImageStoreCallback<TStored>;
}

/**
 * Image generation result with optional storage and tracking identifiers.
 */
export interface GenerateImageResult<TStored = unknown> {
	/** Base64-encoded image bytes returned by the provider. */
	b64Json: string;
	/** Image model used for the request. */
	model: string;
	/** Saved AiRequest id when response logging is enabled; otherwise null. */
	aiRequestId: string | null;
	/** App-owned storage reference returned by the storage callback. */
	stored: TStored | null;
}

/** Tracking metadata and an optional application-specific operation name. */
export interface RequestLogOptions extends AIResponseLogOptions {
	operation?: string;
}

/** Internal lifecycle state for a persisted text request and its current attempt. */
export interface TrackedRequest {
	aiRequest: AiRequest;
	conversation: AiConversation;
	nextSequence: number;
	startTimeMs: number;
	userId: string | null;
	scopeId: string | null;
	/** Model for the current provider attempt; updated when failover switches providers. */
	model: string;
	/** Provider for the current attempt; updated when failover switches providers. */
	provider: AIProvider;
}

/** Internal lifecycle state for a persisted embedding operation. */
export interface TrackedEmbeddingRequest {
	aiRequest: AiRequest;
	startTimeMs: number;
	model: string;
}

/** Internal lifecycle state for a persisted image operation. */
export interface TrackedImageRequest {
	aiRequest: AiRequest;
	startTimeMs: number;
	model: string;
}

/** Normalized provider token counts; null means the provider did not report a value. */
export interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	reasoningTokens: number | null;
	cachedTokens: number | null;
	/** Input tokens written into a billable provider prompt cache. */
	cacheWriteTokens: number | null;
}

/** Minimal identity accepted at a framework ownership boundary. */
export interface AIRecordIdentity { id: unknown; }

/** Model constructors used for every AI persistence operation. */
export interface AIModels {
	conversation: typeof AiConversation;
	request: typeof AiRequest;
	message: typeof import('../AiMessage').AiMessage;
}

/** Embedding persistence policy for workflows that must resume partial provider work. */
export interface GenerateEmbeddingOptions extends RequestLogOptions {
	/** Persist the completed vector in the existing request response for authorized resume. Defaults to false. */
	retainResult?: boolean;
}
