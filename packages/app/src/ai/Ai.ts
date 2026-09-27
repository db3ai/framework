/// <reference path="./sdkNodeCompatibility.d.ts" preserve="true" />
import OpenAI from 'openai';
import { OpenAIProvider, type ModelProvider } from '@openai/agents';
import { aiExecutionContext, scopedAiOptions } from './AiExecutionContext';
import { zodTextFormat } from 'openai/helpers/zod';
import { parseJsonObjectText, responseErrorMessage, responseOutputText } from '@db3.ai/pure';
import { app } from '../server/appContext';
import { AiConversation } from './AiConversation';
import { AiMessage, AI_MESSAGE_ROLE, type AiMessageRole } from './AiMessage';
import { AiRequest, AI_REQUEST_STATUS } from './AiRequest';
const defaultAIConfig = { model: 'gpt-4.1-mini' };
import { estimateTokensFromText } from './Estimates.js';
import { calculateAIImageRequestCostUSD, calculateAIRequestCostUSD } from './modelPricing.js';
import { AI_PROVIDER } from './contracts/AI.js';
import { AIAllowanceExceededError, AIConfigurationError, AIRequestError } from './AIErrors.js';
import { isFailoverableFailure, isFailoverableResponse } from './AIFailover.js';
import { providerChainFromEnvironment, resolveProviderChain, simulatedProviderOutage, type AIProviderAttempt, type AIProviderAttemptFailure } from './AIProviders.js';
import { AIRateLimitDeferredError, AIRateLimiter, embeddingsRateLimitEndpoint, imagesRateLimitEndpoint, providerResponseMetadata, responsesRateLimitEndpoint, type AIProviderResponseMetadata, type AIRateLimitLease } from './AIRateLimiter.js';
import { isOpenAIQuotaError, openAIProviderError } from './OpenAIProviderError.js';
import { providerReportedCostUSD } from './ProviderCosts.js';
import { sendResponsesRequest } from './ResponsesProviderCall.js';
import type { AIAllowanceCheckInput, AIRecordIdentity, AIModels, AIConfig, AIOptions, AIProvider, AIProviderSelection, AIResponseLogOptions, EmbeddingResponsePayloadWithUsage, GenerateEmbeddingResult, GenerateImageInput, GenerateImageOptions, GenerateImageResult, GenerateStructuredInput, GenerateTextInput, GenerateTextResult, ImageResponsePayloadWithUsage, RequestLogOptions, TextResponsePayloadWithUsage, TokenUsage, TrackedEmbeddingRequest, TrackedImageRequest, TrackedRequest } from './contracts/AI.js';

/**
 * Image usage normalized into the generic AiRequest token fields plus the
 * modality-specific counts needed for GPT Image pricing.
 */
interface ImageTokenUsage extends TokenUsage {
	inputTextTokens: number | null;
	inputImageTokens: number | null;
	outputImageTokens: number | null;
	cachedTextTokens: number | null;
	cachedImageTokens: number | null;
}

/**
 * Durable audit input for one provider execution that failed before failover.
 */
interface TrackedProviderAttemptFailure {
	/** Provider and model used for the failed execution. */
	attempt: AIProviderAttempt;
	/** Exact provider request payload sent for this execution. */
	request: Record<string, unknown>;
	/** Parsed provider response, or null when transport failed before a response. */
	response: TextResponsePayloadWithUsage | null;
	/** Sanitized failure details retained on the logical request and attempt row. */
	failure: AIProviderAttemptFailure;
	/** Provider request and rate-limit response metadata, when available. */
	metadata: AIProviderResponseMetadata;
	/** Active rate-limit lease associated with this provider execution. */
	lease: AIRateLimitLease | null;
	/** Epoch milliseconds captured immediately before this attempt began. */
	startedAtMs: number;
}

/**
 * Raised when exact provider usage could not be made durable after bounded retries.
 *
 * This is deliberately distinct from provider and transport failures so callers
 * must not issue another paid provider request in response to a database error.
 */
export class AIUsagePersistenceError extends Error {
	/** Indicates that provider execution already occurred and must not be replayed. */
	readonly providerExecuted = true;

	/**
	 * Creates a terminal AI usage persistence failure.
	 *
	 * @param aiRequestId - Stable tracked request whose assigned outcome was not saved.
	 * @param persistenceCause - Last database error returned by the bounded save attempts.
	 */
	constructor(
		readonly aiRequestId: string | null,
		readonly persistenceCause: unknown,
	) {
		super(`Unable to persist terminal AI usage for request ${aiRequestId ?? 'unknown'}.`);
		this.name = 'AIUsagePersistenceError';
	}
}

/** Total terminal persistence attempts, including the initial save. */
const TERMINAL_AI_REQUEST_SAVE_ATTEMPTS = 3;

/**
 * Small application-level wrapper around OpenAI's Responses API.
 *
 * The service supports plain text generation, structured Zod-backed generation,
 * and persistence of conversations, messages, provider payloads, token usage,
 * and estimated request cost.
 */
export class Ai {
	/** Configured model constructors for app-owned schema extensions. */
	readonly models: AIModels;
	/** Logical ownership field used by this application. */
	readonly scopeField: string;
	private readonly rateLimiter: AIRateLimiter | null;

	/**
	 * Create an AI service instance.
	 *
	 * Pass options to override environment configuration or to inject a test
	 * fetch implementation.
	 */
	constructor(
		protected readonly options: AIOptions = {},
		private readonly modelConfig: AIConfig = defaultAIConfig,
	) {
		if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new AIConfigurationError('timeoutMs must be positive.');
		this.models = { conversation: AiConversation, request: AiRequest, message: AiMessage, ...options.models };
		this.scopeField = options.scopeField ?? 'scope';
		this.rateLimiter = options.rateLimiter === false
			? null
			: options.rateLimiter ?? new AIRateLimiter();
	}

	/**
	 * Returns a named model from application config.
	 *
	 * Concrete agents use their class name as the key and keep a colocated
	 * fallback for configurations that omit the named override.
	 *
	 * @param name - Stable model configuration name.
	 * @param fallback - Model to use when the named entry is absent or empty.
	 * @returns Configured named model or the supplied fallback.
	 *
	 * @example
	 * protected readonly model = app().ai.config(
	 * 	'ArticleGenerationAgent',
	 * 	'gpt-5.6-sol',
	 * );
	 */
	config(name: string, fallback: string): string {
		return this.modelConfig[name]?.trim() || fallback;
	}

	/**
	 * Default model used when a call does not provide its own model.
	 *
	 * @returns Injected model override or the application config default.
	 */
	get model(): string {
		return this.options.model || this.modelConfig.model;
	}

	/**
	 * Whether the service has an API key available.
	 */
	isConfigured(): boolean {
		return Boolean(this.apiKey());
	}

	/**
	 * Checks application/customer allowance before a provider call starts.
	 *
	 * The default implementation is a no-op. Apps can inject an allowance hook
	 * through AIOptions to enforce user, team, website, or billing-period limits
	 * without leaking billing concerns into prompt code.
	 *
	 * @param input - Request context used by the allowance policy.
	 */
	async checkAllowance(input: AIAllowanceCheckInput): Promise<void> {
		if (!this.options.allowance) return;

		await this.options.allowance(input);
	}

	/**
	 * Resolves a provider selection into an ordered failover attempt chain.
	 *
	 * Precedence: the explicit selection, then the app-level default from
	 * AIOptions.provider or AI_PROVIDER_CHAIN, then OpenAI alone. The OpenAI
	 * entry uses this service's resolved key, base URL, and model so single
	 * provider behavior is unchanged.
	 *
	 * @param selection - Selection from a call or agent, or null for defaults.
	 * @param model - Model for the OpenAI entry, or null for the app default.
	 * @returns Ordered configured attempts.
	 * @throws AIConfigurationError when no provider in the chain is usable.
	 */
	resolveProviders(
		selection: AIProviderSelection | null = null,
		model: string | null = null,
	): AIProviderAttempt[] {
		return resolveProviderChain({
			selection: selection ?? this.options.provider ?? providerChainFromEnvironment(),
			openai: {
				apiKey: this.apiKey(),
				baseUrl: this.baseUrl(),
				model: model || this.model,
			},
		});
	}

	/**
	 * Generate text and return only the assistant's text.
	 *
	 * Requests are tracked by default. Pass `saveAiResponse: false` in options
	 * for one-off calls that should not create conversation, request, or message
	 * rows. Use {@link generateTextWithResponse} when callers need persisted ids.
	 *
	 * @throws AIConfigurationError when no API key is configured.
	 * @throws AIRequestError when the provider rejects the request or returns no text.
	 */
	async generateText(
		input: GenerateTextInput,
		options: AIResponseLogOptions = {},
	): Promise<string> {
		const result = await this.generateTextResult(input, options);

		return result.text;
	}

	/**
	 * Generate text and return the assistant text plus tracking ids.
	 *
	 * Creates or appends to an AI conversation, stores system/user messages before
	 * sending the provider request, then stores the assistant message, raw response,
	 * usage metrics, and estimated cost after completion unless
	 * `saveAiResponse: false` is provided.
	 *
	 * @throws AIConfigurationError when no API key is configured.
	 * @throws AIRequestError when the provider rejects the request or returns no text.
	 */
	async generateTextWithResponse(
		input: GenerateTextInput,
		options: AIResponseLogOptions = {},
	): Promise<GenerateTextResult> {
		return this.generateTextResult(input, options);
	}

	/**
	 * Generate structured JSON that must satisfy the supplied Zod schema.
	 *
	 * The schema is sent to the Responses API as a text format, the raw provider
	 * response is logged, and the returned text is parsed and validated locally
	 * before the typed value is returned.
	 *
	 * @throws AIConfigurationError when no API key is configured.
	 * @throws AIRequestError when the provider rejects the request or returns no text.
	 * @throws z.ZodError when the provider output does not match the schema.
	 */
	async generateStructured<TValue>(
		input: GenerateStructuredInput<TValue>,
		options: AIResponseLogOptions = {},
	): Promise<{ data: TValue, aiRequestId: string | null, aiResponseId: string | null, conversationId: string | null }> {

		const result = await this.generateTextResult({
			model: input.model,
			provider: input.provider,
			instructions: input.instructions,
			input: input.input,
			maxOutputTokens: input.maxOutputTokens,
		}, {
			...options,
			agent: options.agent ?? input.schemaName,
			metadata: {
				...(options.metadata ?? {}),
				schemaName: input.schemaName,
			},
			saveAiResponse: options.saveAiResponse,
			operation: 'responses.create.structured',
		}, {
			text: {
				format: zodTextFormat(input.schema, input.schemaName),
			},
		});

		return {
			data: input.schema.parse(parseJsonObjectText(result.text)),
			aiRequestId: result.aiRequestId,
			aiResponseId: result.aiResponseId,
			conversationId: result.conversationId,
		};
	}

	/**
	 * Send a Responses API request through the resolved provider chain and
	 * optionally track it in application tables.
	 *
	 * Tracking is intentionally started before the provider call so failed or slow
	 * requests still leave an auditable pending/failed row with the prompt that was
	 * sent. One stable logical AiRequest is retargeted to the provider that settles
	 * the call. Provider-executed intermediate failures are appended as child rows
	 * with their own usage/cost and summarized in `metadata.providerAttempts`.
	 *
	 * Failover moves to the next provider only for failoverable failures such as
	 * rate limits, overload, 5xx, network errors, and exhausted quota. The final
	 * attempt keeps the existing single-provider error contract, including queue
	 * rate-limit deferrals.
	 */
	private async generateTextResult(
		input: GenerateTextInput,
		options: RequestLogOptions = {},
		extraRequest: Record<string, unknown> = {},
	): Promise<GenerateTextResult> {
		options = scopedAiOptions(options, this.scopeField);
		assertIndependentUsage(options);

		if (typeof input?.input !== 'string' || !input.input.trim()) throw new AIRequestError('Text input is required.', 'invalid_input');
		if (typeof input.instructions !== 'string') throw new AIRequestError('Instructions must be a string.', 'invalid_input');
		if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)) throw new AIRequestError('maxOutputTokens must be a positive integer.', 'invalid_input');

		const operation = options.operation ?? 'responses.create';
		const attempts = this.resolveProviders(input.provider ?? null, input.model ?? null)
			.filter(attempt => attempt.supportsResponsesApi);
		const attemptFailures: AIProviderAttemptFailure[] = [];
		let tracked: TrackedRequest | null = null;
		let trackedSettled = false;

		if (attempts.length === 0) {
			throw new AIConfigurationError('No configured AI provider in the chain supports the Responses API.');
		}

		for (let index = 0; index < attempts.length; index++) {
			const attempt = attempts[index]!;
			const hasFallback = index < attempts.length - 1;
			const attemptStartMs = Date.now();
			const request = {
				model: attempt.model,
				instructions: input.instructions,
				input: input.input,
				store: false,
				...(attempt.provider === AI_PROVIDER.openai ? { service_tier: 'default' } : {}),
				...maxOutputTokensPayload(input.maxOutputTokens),
				...extraRequest,
			};
			const estimatedTokens = estimatedResponseTokens(input, request);
			let lease: AIRateLimitLease | null = null;
			let providerStarted = false;

			try {
				lease = await this.acquireRateLimit({
					provider: attempt.provider,
					endpoint: responsesRateLimitEndpoint(),
					model: attempt.model,
					operation,
					estimatedTokens,
					aiRequest: tracked?.aiRequest ?? null,
				});

				if (!tracked && options.saveAiResponse !== false) {
					tracked = await this.startTrackedRequest(request, input, {
						...options,
						operation,
					}, attempt);
				} else if (tracked) {
					await this.retargetTrackedRequest(tracked, attempt, request);
				}

				await this.checkAllowance({
					provider: attempt.provider,
					endpoint: responsesRateLimitEndpoint(),
					model: attempt.model,
					operation,
					user: tracked?.userId ?? options.user ?? this.activeUser(),
					scope: tracked?.scopeId ?? (options[this.scopeField] as AIRecordIdentity | string | null | undefined) ?? null,
					aiRequest: tracked?.aiRequest ?? null,
					estimatedTokens,
					usage: options.usage ?? null,
					metadata: options.metadata ?? null,
				});

				await this.attachRateLimitRequest(lease, tracked?.aiRequest ?? null);

				const simulatedOutage = simulatedProviderOutage(attempt.provider);

				if (simulatedOutage) throw simulatedOutage;

				providerStarted = true;
				const result = await sendResponsesRequest({
					baseUrl: attempt.baseUrl,
					apiKey: attempt.apiKey,
					request,
					fetcher: this.fetcher(),
				});
				const { payload, metadata } = result;

				if (!result.ok) {
					const message = responseErrorMessage(payload) || `AI provider ${attempt.provider} request failed with HTTP ${result.status}.`;

					if (hasFallback && isFailoverableResponse(result.status, payload)) {
						const failure = providerAttemptFailure(attempt, attemptStartMs, message, result.status, responseErrorCode(payload));

						attemptFailures.push(failure);

						if (tracked) {
							await this.appendTrackedProviderAttempt(tracked, {
								attempt,
								request,
								response: payload,
								failure,
								metadata,
								lease,
								startedAtMs: attemptStartMs,
							});
						}

						await this.observeRateLimit(lease, metadata);
						lease = null;

						continue;
					}

					const deferred = isRateLimitFailure(result.status, payload)
						? rateLimitDeferredError(lease, metadata, message)
						: null;

					if (tracked) {
						attachProviderAttempts(tracked.aiRequest, attemptFailures);
						await this.failTrackedRequest(tracked, payload, message, metadata, lease);
						trackedSettled = true;
					}

					await this.observeRateLimit(lease, metadata);
					lease = null;

					if (deferred) throw deferred;

					throw new AIRequestError(message, responseErrorCode(payload));
				}

				const text = payload?.status !== undefined && payload.status !== 'completed' ? null : responseOutputText(payload);

				if (!text) {
					const message = `AI provider ${attempt.provider} did not return a valid response.`;

					if (tracked) {
						attachProviderAttempts(tracked.aiRequest, attemptFailures);
						await this.failTrackedRequest(tracked, payload, message, metadata, lease);
						trackedSettled = true;
					}

					await this.observeRateLimit(lease, metadata);
					lease = null;

					throw new AIRequestError(message);
				}

				if (tracked) {
					attachProviderAttempts(tracked.aiRequest, attemptFailures);
					await this.completeTrackedRequest(tracked, payload, metadata, lease);
					trackedSettled = true;
					await this.saveMessage({
						conversation: tracked.conversation,
						aiRequest: tracked.aiRequest,
						user: tracked.userId,
						scope: tracked.scopeId,
						role: AI_MESSAGE_ROLE.assistant,
						content: text,
						provider: tracked.provider,
						model: tracked.model,
						sequence: tracked.nextSequence,
						metadata: tracked.aiRequest.metadata,
					});
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				return {
					text,
					aiRequestId: tracked?.aiRequest.id ? String(tracked.aiRequest.id) : null,
					aiResponseId: tracked?.aiRequest.id ? String(tracked.aiRequest.id) : null,
					conversationId: tracked?.conversation.id ? String(tracked.conversation.id) : null,
				};
			} catch (error) {
				const failedLease = lease;

				if (error instanceof AIUsagePersistenceError) {
					try {
						await this.releaseRateLimit(lease);
					} finally {
						throw error;
					}
				}

				await this.releaseRateLimit(lease);
				lease = null;

				if (hasFallback && !trackedSettled && isFailoverableFailure(error)) {
					const failure = providerAttemptFailureFromError(attempt, attemptStartMs, error);

					attemptFailures.push(failure);

					if (tracked && providerStarted) {
						await this.appendTrackedProviderAttempt(tracked, {
							attempt,
							request,
							response: null,
							failure,
							metadata: emptyProviderResponseMetadata(),
							lease: failedLease,
							startedAtMs: attemptStartMs,
						});
					}

					continue;
				}

				if (tracked && !trackedSettled && !(error instanceof AIRequestError) && !(error instanceof AIRateLimitDeferredError)) {
					attachProviderAttempts(tracked.aiRequest, attemptFailures);
					await this.failTrackedRequest(
						tracked,
						null,
						errorMessage(error),
						emptyProviderResponseMetadata(),
						failedLease,
						providerStarted,
					);
				}

				throw error;
			}
		}

		// Unreachable: the final attempt always returns or throws above.
		throw new AIRequestError();
	}

	/**
	 * Points an existing tracked request at the provider attempt now being tried.
	 *
	 * @param tracked - Tracked request created by an earlier attempt.
	 * @param attempt - Provider attempt about to run.
	 * @param request - Provider request payload for this attempt.
	 */
	private async retargetTrackedRequest(
		tracked: TrackedRequest,
		attempt: AIProviderAttempt,
		request: Record<string, unknown>,
	): Promise<void> {
		if (tracked.provider === attempt.provider && tracked.model === attempt.model) return;

		tracked.provider = attempt.provider;
		tracked.model = attempt.model;
		tracked.aiRequest.assign({
			provider: attempt.provider,
			model: attempt.model,
			request,
		});

		await tracked.aiRequest.save();
	}

	/**
	 * Appends one failed provider execution beneath the stable logical request.
	 *
	 * Failover retargets the logical request to the provider that ultimately
	 * settles it. Keeping prior provider executions as children prevents their
	 * returned usage and cost from being overwritten while preserving the public
	 * logical request id used by callers and application records.
	 *
	 * @param tracked - Stable logical request that owns the failover chain.
	 * @param input - Failed provider execution payload, usage, and audit metadata.
	 */
	private async appendTrackedProviderAttempt(
		tracked: TrackedRequest,
		input: TrackedProviderAttemptFailure,
	): Promise<void> {
		const usage = tokenUsage(input.response);
		const modelCostUSD = textRequestCostUSD(input.attempt.provider, input.attempt.model, usage, input.response);

		const aiRequest = new this.models.request({
			conversation: tracked.conversation,
			parentAiRequest: tracked.aiRequest,
			user: tracked.userId,
			[this.scopeField]: tracked.scopeId,
			provider: input.attempt.provider,
			model: input.attempt.model,
			operation: `${tracked.aiRequest.operation || 'responses.create'}.attempt`,
			status: AI_REQUEST_STATUS.failed,
			request: input.request,
			response: input.response,
			providerRequestId: input.metadata.providerRequestId,
			providerProcessingMs: input.metadata.providerProcessingMs,
			rateLimitBucket: input.lease?.bucket ?? null,
			rateLimitSnapshot: input.metadata.rateLimitSnapshot,
			startedAt: new Date(input.startedAtMs),
			completedAt: new Date(),
			durationMs: input.failure.durationMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD: modelCostUSD,
			knownCostUSD: modelCostUSD ?? 0,
			errorCode: input.failure.code,
			errorMessage: input.failure.message,
			metadata: {
				...(tracked.aiRequest.metadata ?? {}),
				outcome: 'provider_failover_attempt',
				providerAttempt: input.failure,
				providerStarted: true,
			},
		});

		await saveTerminalAiRequest(aiRequest);
	}

	/**
	 * Create the conversation, pending request row, and initial system/user
	 * messages for a tracked provider call.
	 */
	private async startTrackedRequest(
		request: Record<string, unknown>,
		input: GenerateTextInput,
		options: Required<Pick<RequestLogOptions, 'operation'>> & RequestLogOptions,
		attempt: AIProviderAttempt,
	): Promise<TrackedRequest> {
		const user = options.user ?? this.activeUser();
		const userId = userRecordId(user);
		const scopeId = scopeRecordId(options[this.scopeField] as AIRecordIdentity | string | null | undefined ?? null);
		const conversation = await this.resolveConversation({
			conversation: options.conversation,
			userId,
			scopeId,
			agent: options.agent ?? null,
			title: options.title ?? null,
			metadata: options.metadata ?? null,
		});
		const startedAt = new Date();
		const startTimeMs = Date.now();
		const aiRequest = await new this.models.request({
			conversation,
			parentAiRequest: options.parentAiRequest ?? null,
			user: userId,
			[this.scopeField]: scopeId,
			provider: attempt.provider,
			model: attempt.model,
			operation: options.operation,
			status: AI_REQUEST_STATUS.pending,
			request,
			metadata: options.metadata ?? null,
			startedAt,
		}).save();
		let nextSequence = await this.nextMessageSequence(conversation);

		nextSequence = await this.saveMessage({
			conversation,
			aiRequest,
			user: userId,
			scope: scopeId,
			role: AI_MESSAGE_ROLE.system,
			content: input.instructions,
			provider: attempt.provider,
			model: attempt.model,
			sequence: nextSequence,
			metadata: options.metadata ?? null,
		});

		nextSequence = await this.saveMessage({
			conversation,
			aiRequest,
			user: userId,
			scope: scopeId,
			role: AI_MESSAGE_ROLE.user,
			content: input.input,
			provider: attempt.provider,
			model: attempt.model,
			sequence: nextSequence,
			metadata: options.metadata ?? null,
		});

		return {
			aiRequest,
			conversation,
			nextSequence,
			startTimeMs,
			userId,
			scopeId,
			model: attempt.model,
			provider: attempt.provider,
		};
	}

	/**
	 * Marks a tracked text request completed with exact provider usage and cost.
	 *
	 * Assistant-message persistence happens only after this terminal request update
	 * succeeds, allowing the caller to protect completed usage from ancillary errors.
	 *
	 * @param tracked - Tracked logical request state.
	 * @param response - Provider response payload containing terminal usage.
	 * @param metadata - Parsed provider response metadata.
	 * @param lease - Rate-limit lease used for the provider request.
	 */
	private async completeTrackedRequest(
		tracked: TrackedRequest,
		response: TextResponsePayloadWithUsage | null,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
	): Promise<void> {
		const usage = tokenUsage(response);
		const costUSD = textRequestCostUSD(tracked.provider, tracked.model, usage, response);

		tracked.aiRequest.assign({
			response,
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.completed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Mark a tracked request failed with the provider error code, when available.
	 *
	 * @param tracked - Tracked logical request state.
	 * @param response - Provider response payload, when available.
	 * @param message - Failure message to persist.
	 * @param metadata - Parsed provider response metadata.
	 * @param lease - Rate-limit lease used for the provider request.
	 * @param providerStarted - Whether execution crossed the external provider boundary.
	 */
	private async failTrackedRequest(
		tracked: TrackedRequest,
		response: TextResponsePayloadWithUsage | null,
		message: string,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
		providerStarted = true,
	): Promise<void> {
		const usage = tokenUsage(response);
		const costUSD = !providerStarted
			? 0
			: textRequestCostUSD(tracked.provider, tracked.model, usage, response);

		tracked.aiRequest.assign({
			response,
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.failed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
			errorCode: responseErrorCode(response),
			errorMessage: message,
			metadata: {
				...(tracked.aiRequest.metadata ?? {}),
				providerStarted,
			},
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Resolve the target conversation for a tracked request.
	 *
	 * Existing conversations can be supplied by record or id; otherwise a new
	 * conversation is created using the provided context.
	 */
	private async resolveConversation(input: {
		conversation?: AiConversation | string | null;
		userId: string | null;
		scopeId: string | null;
		agent: string | null;
		title: string | null;
		metadata: Record<string, unknown> | null;
	}): Promise<AiConversation> {
		if (input.conversation instanceof AiConversation) {
			return input.conversation;
		}

		if (typeof input.conversation === 'string' && input.conversation.trim()) {
			return await this.models.conversation.findOrFail(input.conversation);
		}

		return await new this.models.conversation({
			user: input.userId,
			[this.scopeField]: input.scopeId,
			agent: input.agent,
			title: input.title,
			metadata: input.metadata,
		}).save();
	}

	/**
	 * Resolves an optional conversation without creating a new one.
	 *
	 * @param conversation - Optional conversation record or id.
	 * @returns Existing conversation record, or null when omitted.
	 */
	private async resolveOptionalConversation(
		conversation?: AiConversation | string | null,
	): Promise<AiConversation | null> {
		if (conversation instanceof AiConversation) return conversation;
		if (typeof conversation === 'string' && conversation.trim()) {
			return await this.models.conversation.findOrFail(conversation);
		}

		return null;
	}

	/**
	 * Return the next message sequence number for a saved conversation.
	 */
	private async nextMessageSequence(conversation: AiConversation): Promise<number> {
		if (!conversation.id) {
			throw new Error('AI conversation must be saved before adding messages.');
		}

		const lastMessage = await this.models.message
			.where('conversation', String(conversation.id))
			.orderBy('sequence', 'desc')
			.first();

		return (lastMessage?.sequence ?? 0) + 1;
	}

	/**
	 * Persist one conversation message and return the following sequence number.
	 */
	private async saveMessage(input: {
		conversation: AiConversation;
		aiRequest: AiRequest;
		user: string | null;
		scope: string | null;
		role: AiMessageRole;
		content: string | null;
		contentJson?: unknown | null;
		provider: AIProvider;
		model: string;
		sequence: number;
		metadata: Record<string, unknown> | null;
	}): Promise<number> {
		await new this.models.message({
			conversation: input.conversation,
			aiRequest: input.aiRequest,
			user: input.user,
			[this.scopeField]: input.scope,
			role: input.role,
			sequence: input.sequence,
			content: input.content,
			contentJson: input.contentJson ?? null,
			provider: input.provider,
			model: input.model,
			metadata: input.metadata,
		}).save();

		return input.sequence + 1;
	}

	/**
	 * Create a pending request row for an embedding call.
	 */
	private async startTrackedEmbeddingRequest(
		request: Record<string, unknown>,
		options: Required<Pick<RequestLogOptions, 'operation'>> & RequestLogOptions,
		model: string,
	): Promise<TrackedEmbeddingRequest> {
		const user = options.user ?? this.activeUser();
		const userId = userRecordId(user);
		const scopeId = scopeRecordId(options[this.scopeField] as AIRecordIdentity | string | null | undefined ?? null);
		const conversation = await this.resolveOptionalConversation(options.conversation);
		const startTimeMs = Date.now();
		const aiRequest = await new this.models.request({
			conversation,
			parentAiRequest: options.parentAiRequest ?? null,
			user: userId,
			[this.scopeField]: scopeId,
			provider: AI_PROVIDER.openai,
			model,
			operation: options.operation,
			status: AI_REQUEST_STATUS.pending,
			request,
			metadata: options.metadata ?? null,
			startedAt: new Date(),
		}).save();

		return {
			aiRequest,
			startTimeMs,
			model,
		};
	}

	/**
	 * Mark an embedding request completed with normalized token usage.
	 */
	private async completeTrackedEmbeddingRequest(
		tracked: TrackedEmbeddingRequest,
		response: EmbeddingResponsePayloadWithUsage | null,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
	): Promise<void> {
		const usage = embeddingTokenUsage(response);
		const costUSD = calculateAIRequestCostUSD(tracked.model, usage);

		tracked.aiRequest.assign({
			response: compactEmbeddingResponse(response),
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.completed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Mark an embedding request failed and keep a compact provider payload.
	 *
	 * @param tracked - Tracked embedding request state.
	 * @param response - Provider response payload, when available.
	 * @param message - Failure message to persist.
	 * @param metadata - Parsed provider response metadata.
	 * @param lease - Rate-limit lease used for the provider request.
	 * @param providerStarted - Whether execution crossed the external provider boundary.
	 */
	private async failTrackedEmbeddingRequest(
		tracked: TrackedEmbeddingRequest,
		response: EmbeddingResponsePayloadWithUsage | null,
		message: string,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
		providerStarted = true,
	): Promise<void> {
		const usage = embeddingTokenUsage(response);
		const costUSD = providerStarted
			? calculateAIRequestCostUSD(tracked.model, usage)
			: 0;

		tracked.aiRequest.assign({
			response: compactEmbeddingResponse(response),
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.failed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
			errorCode: responseErrorCode(response),
			errorMessage: message,
			metadata: {
				...(tracked.aiRequest.metadata ?? {}),
				providerStarted,
			},
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Create a pending request row for an image generation call.
	 *
	 * @param request - Provider request payload.
	 * @param options - Logging context with a required operation.
	 * @param model - Image model used for the request.
	 * @returns Tracked image request state.
	 */
	private async startTrackedImageRequest(
		request: Record<string, unknown>,
		options: Required<Pick<RequestLogOptions, 'operation'>> & RequestLogOptions,
		model: string,
	): Promise<TrackedImageRequest> {
		const user = options.user ?? this.activeUser();
		const userId = userRecordId(user);
		const scopeId = scopeRecordId(options[this.scopeField] as AIRecordIdentity | string | null | undefined ?? null);
		const conversation = await this.resolveOptionalConversation(options.conversation);
		const startTimeMs = Date.now();
		const aiRequest = await new this.models.request({
			conversation,
			parentAiRequest: options.parentAiRequest ?? null,
			user: userId,
			[this.scopeField]: scopeId,
			provider: AI_PROVIDER.openai,
			model,
			operation: options.operation,
			status: AI_REQUEST_STATUS.pending,
			request,
			metadata: options.metadata ?? null,
			startedAt: new Date(),
		}).save();

		return {
			aiRequest,
			startTimeMs,
			model,
		};
	}

	/**
	 * Mark an image request completed with its app-owned storage reference.
	 *
	 * @param tracked - Tracked image request state.
	 * @param storedResponse - Storage path, id, or record returned by the caller.
	 * @param providerResponse - Provider payload used to normalize token usage.
	 * @param metadata - Parsed provider response headers.
	 * @param lease - Active rate-limit lease.
	 */
	private async completeTrackedImageRequest(
		tracked: TrackedImageRequest,
		storedResponse: unknown,
		providerResponse: ImageResponsePayloadWithUsage | null,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
	): Promise<void> {
		const usage = imageTokenUsage(providerResponse);
		const costUSD = calculateAIImageRequestCostUSD(tracked.model, usage);

		tracked.aiRequest.assign({
			response: storedResponse,
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.completed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Mark an image request failed and keep compact provider metadata.
	 *
	 * @param tracked - Tracked image request state.
	 * @param response - Provider response payload, when available.
	 * @param message - Failure message to store.
	 * @param metadata - Parsed provider response headers.
	 * @param lease - Active rate-limit lease.
	 * @param providerStarted - Whether execution crossed the external provider boundary.
	 */
	private async failTrackedImageRequest(
		tracked: TrackedImageRequest,
		response: ImageResponsePayloadWithUsage | null,
		message: string,
		metadata: AIProviderResponseMetadata = emptyProviderResponseMetadata(),
		lease: AIRateLimitLease | null = null,
		providerStarted = true,
	): Promise<void> {
		const usage = imageTokenUsage(response);
		const costUSD = providerStarted
			? calculateAIImageRequestCostUSD(tracked.model, usage)
			: 0;

		tracked.aiRequest.assign({
			response: compactImageResponse(response),
			providerRequestId: metadata.providerRequestId,
			providerProcessingMs: metadata.providerProcessingMs,
			rateLimitBucket: lease?.bucket ?? null,
			rateLimitSnapshot: metadata.rateLimitSnapshot,
			status: AI_REQUEST_STATUS.failed,
			completedAt: new Date(),
			durationMs: Date.now() - tracked.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD,
			knownCostUSD: costUSD ?? 0,
			errorCode: responseErrorCode(response),
			errorMessage: message,
			metadata: {
				...(tracked.aiRequest.metadata ?? {}),
				providerStarted,
			},
		});

		await saveTerminalAiRequest(tracked.aiRequest);
	}

	/**
	 * Best-effort lookup of the authenticated application user.
	 */
	protected activeUser(): AIRecordIdentity | null {
		try {
			return app().auth.user as AIRecordIdentity | null;
		} catch {
			return null;
		}
	}

	/**
	 * API key from explicit options or OPENAI_API_KEY.
	 */
	public apiKey(): string {
		return this.options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
	}

	/**
	 * Return the configured API key or fail with the public configuration error.
	 */
	private requireApiKey(): string {
		const apiKey = this.apiKey();

		if (!apiKey) {
			throw new AIConfigurationError();
		}

		return apiKey;
	}

	/**
	 * Creates an SDK adapter that observes and releases capacity for each HTTP request.
	 *
	 * @param attempt - Resolved provider connection and model.
	 * @param initialLease - Optional preflight reservation consumed by the first request.
	 * @returns SDK provider using the service's transport and rate-limit lifecycle.
	 */
	createAgentProvider(attempt: AIProviderAttempt, initialLease: AIRateLimitLease | null = null): ModelProvider {
		return new OpenAIProvider({
			openAIClient: new OpenAI({ apiKey: attempt.apiKey, baseURL: attempt.baseUrl, fetch: this.agentFetcher(attempt, initialLease), timeout: this.options.timeoutMs ?? 60_000, maxRetries: 0 }),
			useResponses: attempt.supportsResponsesApi,
		});
	}

	/**
	 * Reserves each SDK model turn and observes headers before streaming or tool execution.
	 *
	 * The agent's preflight lease covers only its first HTTP request. Releasing it
	 * when headers arrive lets nested tools and concurrent agents use the bucket,
	 * including providers that omit capacity headers. Later turns reserve again.
	 * Transport and persistence failures still release their active reservation.
	 *
	 * @param attempt - Provider and model selected for this SDK attempt.
	 * @param initialLease - First-request reservation, if acquired by the agent.
	 * @returns Transport that maintains provider capacity and request diagnostics.
	 */
	private agentFetcher(attempt: AIProviderAttempt, initialLease: AIRateLimitLease | null): typeof fetch {
		let pendingLease = initialLease;
		const transport = this.fetcher();
		return async (url, init) => {
			const aiRequest = aiExecutionContext.getStore()?.aiRequest ?? null;
			const lease = pendingLease ?? await this.acquireRateLimit({
				provider: attempt.provider,
				endpoint: responsesRateLimitEndpoint(),
				model: attempt.model,
				operation: aiRequest?.operation ?? 'agents.run.stream',
				estimatedTokens: estimateTokensFromText(typeof init?.body === 'string' ? init.body : ''),
				aiRequest,
			});
			pendingLease = null;
			let response: Response | null = null;

			try {
				response = await transport(url, init);
				const metadata = providerResponseMetadata(response.headers);
				await this.observeRateLimit(lease, metadata);

				if (aiRequest) {
					aiRequest.assign({
						providerRequestId: metadata.providerRequestId,
						providerProcessingMs: metadata.providerProcessingMs,
						rateLimitBucket: lease?.bucket ?? null,
						rateLimitSnapshot: metadata.rateLimitSnapshot,
					});
					await aiRequest.save();
				}

				return response;
			} catch (error) {
				await response?.body?.cancel().catch(() => {});
				throw error;
			} finally {
				await this.releaseRateLimit(lease);
			}
		};
	}

	/**
	 * Fetch implementation used by provider calls.
	 */
	private fetcher(): typeof fetch {
		const transport = this.options.fetch || fetch;
		return (url, init) => transport(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000) });
	}

	/**
	 * Responses API base URL with trailing slashes removed.
	 */
	private baseUrl(): string {
		return (this.options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
			.replace(/\/+$/g, '');
	}

	/**
	 * Full Embeddings API endpoint URL.
	 */
	private embeddingsUrl(): string {
		return `${this.baseUrl()}/embeddings`;
	}

	/**
	 * Full Images API generations endpoint URL.
	 */
	private imagesUrl(): string {
		return `${this.baseUrl()}/images/generations`;
	}

	/**
	 * Reserves provider capacity when rate limiting is enabled.
	 *
	 * @param input - Endpoint, model, operation, and estimated token cost.
	 * @returns Active rate-limit lease, or null when no limiter is configured.
	 */
	async acquireRateLimit(
		input: Parameters<AIRateLimiter['acquire']>[0],
	): Promise<AIRateLimitLease | null> {
		return this.rateLimiter
			? await this.rateLimiter.acquire(input)
			: null;
	}

	/**
	 * Applies provider header metadata to the bucket and releases the lease.
	 *
	 * @param lease - Active rate-limit lease.
	 * @param metadata - Parsed provider response headers.
	 */
	async observeRateLimit(
		lease: AIRateLimitLease | null,
		metadata: AIProviderResponseMetadata,
	): Promise<void> {
		if (!this.rateLimiter || !lease) return;

		await this.rateLimiter.observe(lease, metadata);
	}

	/**
	 * Attaches a saved request row to an existing reservation.
	 *
	 * @param lease - Active rate-limit lease.
	 * @param aiRequest - Saved request row to link.
	 */
	private async attachRateLimitRequest(
		lease: AIRateLimitLease | null,
		aiRequest: AiRequest | null,
	): Promise<void> {
		if (!lease?.reservation || !aiRequest) return;

		lease.reservation.assign({
			aiRequest,
		});

		await lease.reservation.save();
	}

	/**
	 * Releases a rate-limit reservation after local failures.
	 *
	 * @param lease - Active rate-limit lease.
	 */
	async releaseRateLimit(lease: AIRateLimitLease | null): Promise<void> {
		if (!this.rateLimiter || !lease) return;

		await this.rateLimiter.release(lease);
	}

	/**
	 * Generate one image and track the provider request by default.
	 *
	 * Callers can provide a storage callback to save the returned image bytes.
	 * The callback result is stored on `AiRequest.response`, which keeps the
	 * audit row pointed at the app-owned file id/path without persisting raw
	 * image bytes in the database.
	 *
	 * @param input - Prompt and image generation settings.
	 * @param options - Optional request context and storage callback.
	 * @returns Generated image bytes, model, tracking id, and storage reference.
	 */
	async generateImage<TStored = unknown>(
		input: GenerateImageInput,
		options: GenerateImageOptions<TStored> = {},
	): Promise<GenerateImageResult<TStored>> {
		options = scopedAiOptions(options, this.scopeField);
		assertIndependentUsage(options);

		const apiKey = this.requireApiKey();
		const model = input.model || this.config('ImageGeneration', 'gpt-image-2');
		const prompt = input.prompt.replace(/\s+/g, ' ').trim();
		const outputFormat = input.outputFormat ?? 'png';
		const operation = options.operation ?? 'images.generate';
		const request = {
			model,
			prompt,
			size: input.size,
			quality: input.quality,
			output_format: outputFormat,
			user: input.user ?? undefined,
		};
		let tracked: TrackedImageRequest | null = null;
		let lease: AIRateLimitLease | null = null;
		let trackedSettled = false;
		let providerStarted = false;

		if (!prompt) throw new Error('Prompt is required for image generation.');

		try {
			tracked = options.saveAiResponse !== false
				? await this.startTrackedImageRequest(request, {
					...options,
					operation,
				}, model)
				: null;

			await this.checkAllowance({
				provider: AI_PROVIDER.openai,
				endpoint: imagesRateLimitEndpoint(),
				model,
				operation,
				user: options.user ?? input.user ?? null,
				scope: options[this.scopeField] as AIRecordIdentity | string | null | undefined ?? null,
				aiRequest: tracked?.aiRequest ?? null,
				estimatedTokens: estimatedImageTokens(input),
				usage: options.usage ?? null,
				metadata: {
					...(options.metadata ?? {}),
					imageSize: input.size ?? null,
					imageQuality: input.quality ?? null,
					outputFormat,
				},
			});

			lease = await this.acquireRateLimit({
				endpoint: imagesRateLimitEndpoint(),
				model,
				operation,
				estimatedTokens: estimatedImageTokens(input),
				aiRequest: tracked?.aiRequest ?? null,
			});

			await this.attachRateLimitRequest(lease, tracked?.aiRequest ?? null);

			providerStarted = true;
			const response = await this.fetcher()(this.imagesUrl(), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify(request),
			});
			const metadata = providerResponseMetadata(response.headers);
			const payload = await response.json().catch(() => null) as ImageResponsePayloadWithUsage | null;

			if (!response.ok) {
				const message = responseErrorMessage(payload as TextResponsePayloadWithUsage | null) || `OpenAI image request failed with HTTP ${response.status}.`;
				const deferred = isRateLimitFailure(response.status, payload)
					? rateLimitDeferredError(lease, metadata, message)
					: null;

				if (tracked) {
					await this.failTrackedImageRequest(tracked, payload, message, metadata, lease);
					trackedSettled = true;
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				if (deferred) throw deferred;

				throw new AIRequestError(message, responseErrorCode(payload));
			}

			const b64Json = imageBase64(payload);

			if (!b64Json) {
				const message = 'OpenAI did not return image data.';

				if (tracked) {
					await this.failTrackedImageRequest(tracked, payload, message, metadata, lease);
					trackedSettled = true;
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				throw new AIRequestError(message, responseErrorCode(payload));
			}

			let stored: TStored | null = null;

			try {
				stored = options.store
					? await options.store({
						b64Json,
						aiRequest: tracked?.aiRequest ?? null,
						aiRequestId: tracked?.aiRequest.id ? String(tracked.aiRequest.id) : null,
						model,
						prompt,
						size: input.size ?? null,
						quality: input.quality ?? null,
						outputFormat,
						providerResponse: compactImageResponse(payload),
					})
					: null;
			} catch (error) {
				if (tracked) {
					await this.failTrackedImageRequest(tracked, payload, errorMessage(error), metadata, lease);
					trackedSettled = true;
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				throw error;
			}

			if (tracked) {
				await this.completeTrackedImageRequest(tracked, imageStoredResponse(stored) ?? compactImageResponse(payload), payload, metadata, lease);
				trackedSettled = true;
			}

			await this.observeRateLimit(lease, metadata);
			lease = null;

			return {
				b64Json,
				model,
				aiRequestId: tracked?.aiRequest.id ? String(tracked.aiRequest.id) : null,
				stored,
			};
		} catch (error) {
			if (error instanceof AIUsagePersistenceError) {
				try {
					await this.releaseRateLimit(lease);
				} finally {
					throw error;
				}
			}

			await this.releaseRateLimit(lease);

			if (tracked && !trackedSettled) {
				await this.failTrackedImageRequest(
					tracked,
					null,
					errorMessage(error),
					emptyProviderResponseMetadata(),
					lease,
					providerStarted,
				);
			}

			if (error instanceof AIRateLimitDeferredError) throw error;
			if (error instanceof AIAllowanceExceededError) throw error;
			if (error instanceof AIRequestError) throw error;

			throw new AIRequestError(errorMessage(error));
		}
	}

	/**
	 * Generate an embedding vector and track provider usage by default.
	 *
	 * @param input - Text to embed.
	 * @param model - OpenAI embedding model to use.
	 * @param options - Optional AI request logging context.
	 * @returns Embedding vector, model, and saved request id when tracking is enabled.
	 */
	async generateEmbedding(
		input: string,
		model: string = 'text-embedding-3-small',
		options: RequestLogOptions = {},
	): Promise<GenerateEmbeddingResult> {
		options = scopedAiOptions(options, this.scopeField);
		assertIndependentUsage(options);

		if (!input) throw new Error('Input is required for embedding generation.');

		const apiKey = this.requireApiKey();
		const operation = options.operation ?? 'embeddings.create';
		const request = {
			model,
			input,
			encoding_format: 'float',
		};
		let tracked: TrackedEmbeddingRequest | null = null;
		let lease: AIRateLimitLease | null = null;
		let trackedSettled = false;
		let providerStarted = false;

		try {
			lease = await this.acquireRateLimit({
				endpoint: embeddingsRateLimitEndpoint(),
				model,
				operation,
				estimatedTokens: estimatedEmbeddingTokens(input),
				aiRequest: null,
			});
			tracked = options.saveAiResponse !== false
				? await this.startTrackedEmbeddingRequest(request, {
					...options,
					operation,
				}, model)
				: null;

			await this.checkAllowance({
				provider: AI_PROVIDER.openai,
				endpoint: embeddingsRateLimitEndpoint(),
				model,
				operation,
				user: options.user ?? this.activeUser(),
				scope: options[this.scopeField] as AIRecordIdentity | string | null | undefined ?? null,
				aiRequest: tracked?.aiRequest ?? null,
				estimatedTokens: estimatedEmbeddingTokens(input),
				usage: options.usage ?? null,
				metadata: options.metadata ?? null,
			});

			await this.attachRateLimitRequest(lease, tracked?.aiRequest ?? null);
			providerStarted = true;
			const response = await this.fetcher()(this.embeddingsUrl(), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${apiKey}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify(request),
			});
			const metadata = providerResponseMetadata(response.headers);
			const payload = await response.json().catch(() => null) as EmbeddingResponsePayloadWithUsage | null;

			if (!response.ok) {
				const message = responseErrorMessage(payload as TextResponsePayloadWithUsage | null) || `OpenAI embedding request failed with HTTP ${response.status}.`;
				const deferred = isRateLimitFailure(response.status, payload)
					? rateLimitDeferredError(lease, metadata, message)
					: null;

				if (tracked) {
					await this.failTrackedEmbeddingRequest(tracked, payload, message, metadata, lease);
					trackedSettled = true;
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				if (deferred) throw deferred;

				throw new AIRequestError(message, responseErrorCode(payload));
			}

			const vector = payload?.data?.[0]?.embedding;
			if (!Array.isArray(vector)) {
				const message = 'OpenAI did not return a valid embedding.';

				if (tracked) {
					await this.failTrackedEmbeddingRequest(tracked, payload, message, metadata, lease);
					trackedSettled = true;
				}

				await this.observeRateLimit(lease, metadata);
				lease = null;

				throw new AIRequestError(message, responseErrorCode(payload));
			}

			if (tracked) {
				await this.completeTrackedEmbeddingRequest(tracked, payload, metadata, lease);
				trackedSettled = true;
			}

			await this.observeRateLimit(lease, metadata);
			lease = null;

			return {
				vector,
				model,
				aiRequestId: tracked?.aiRequest.id ? String(tracked.aiRequest.id) : null,
			};
		} catch (error) {
			if (error instanceof AIUsagePersistenceError) {
				try {
					await this.releaseRateLimit(lease);
				} finally {
					throw error;
				}
			}

			await this.releaseRateLimit(lease);

			if (tracked && !trackedSettled && !(error instanceof AIRequestError) && !(error instanceof AIRateLimitDeferredError)) {
				await this.failTrackedEmbeddingRequest(
					tracked,
					null,
					errorMessage(error),
					emptyProviderResponseMetadata(),
					lease,
					providerStarted,
				);
			}

			if (error instanceof AIRateLimitDeferredError) throw error;
			if (error instanceof AIRequestError) throw error;

			throw new AIRequestError(errorMessage(error));
		}
	}
}

/**
 * Makes one already-assigned terminal AI request outcome durable.
 *
 * Retries update the same model instance without changing its payload, status,
 * usage, or cost. This prevents a transient database acknowledgement failure
 * from causing paid provider work to be replayed or rewritten as usage-free.
 *
 * @param aiRequest - Request whose exact terminal fields were assigned by the caller.
 * @throws {AIUsagePersistenceError} When all bounded save attempts fail.
 */
async function saveTerminalAiRequest(aiRequest: AiRequest): Promise<void> {
	let persistenceCause: unknown = null;

	for (let attempt = 0; attempt < TERMINAL_AI_REQUEST_SAVE_ATTEMPTS; attempt++) {
		try {
			await aiRequest.save();
			return;
		} catch (error) {
			persistenceCause = error;
		}
	}

	throw new AIUsagePersistenceError(
		aiRequest.id ? String(aiRequest.id) : null,
		persistenceCause,
	);
}

export { AIAllowanceExceededError, AIConfigurationError, AIRequestError } from './AIErrors.js';

export { AI_PROVIDER };

export type {
	AIAllowanceChecker,
	AIAllowanceCheckInput,
	AIRecordIdentity,
	AIModels,
	AIConfig,
	AIOptions,
	AIProvider,
	AIProviderSelection,
	AIResponseLogOptions,
	GenerateEmbeddingResult,
	GenerateImageInput,
	GenerateImageOptions,
	GenerateImageResult,
	GenerateImageStoreInput,
	GenerateStructuredInput,
	GenerateTextInput,
	GenerateTextResult,
} from './contracts/AI.js';

/**
 * Empty provider metadata used when a request fails before reaching OpenAI.
 *
 * @returns Null-valued provider metadata.
 */
function emptyProviderResponseMetadata(): AIProviderResponseMetadata {
	return {
		providerRequestId: null,
		providerProcessingMs: null,
		rateLimitSnapshot: null,
	};
}

/**
 * Builds the optional Responses API max_output_tokens payload.
 *
 * @param maxOutputTokens - Optional maximum output token count.
 * @returns Request fragment to merge into a provider payload.
 */
function maxOutputTokensPayload(maxOutputTokens: number | undefined): Record<string, number> {
	return typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
		? {
			max_output_tokens: Math.trunc(maxOutputTokens),
		}
		: {};
}

/**
 * Estimates request size before OpenAI returns exact usage.
 *
 * @param input - Text generation input.
 * @param request - Provider request payload.
 * @returns Conservative token estimate for reservation accounting.
 */
function estimatedResponseTokens(
	input: GenerateTextInput,
	request: Record<string, unknown>,
): number {
	const outputEstimate = typeof input.maxOutputTokens === 'number' && Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0
		? Math.trunc(input.maxOutputTokens)
		: 0;
	const text = [
		input.instructions,
		input.input,
		JSON.stringify(request.text ?? ''),
	].join('\n');

	return estimateTokensFromText(text) + outputEstimate;
}

/**
 * Estimates embedding input size before OpenAI returns exact usage.
 *
 * @param input - Text being embedded.
 * @returns Approximate token count.
 */
function estimatedEmbeddingTokens(input: string): number {
	return estimateTokensFromText(input);
}

/**
 * Estimates image request size before OpenAI returns any usage metadata.
 *
 * @param input - Image generation request.
 * @returns Approximate prompt token count.
 */
function estimatedImageTokens(input: GenerateImageInput): number {
	return estimateTokensFromText(input.prompt);
}

/**
 * Builds the sanitized audit record for one failed provider attempt.
 *
 * @param attempt - Provider attempt that failed.
 * @param startMs - Epoch milliseconds when the attempt started.
 * @param message - Human-readable failure message.
 * @param status - HTTP status, when the provider responded.
 * @param code - Provider error code, when supplied.
 * @returns Attempt failure entry for AiRequest metadata.
 */
function providerAttemptFailure(
	attempt: AIProviderAttempt,
	startMs: number,
	message: string,
	status: number | null,
	code: string | null,
): AIProviderAttemptFailure {
	return {
		provider: attempt.provider,
		model: attempt.model,
		status,
		code,
		message,
		durationMs: Date.now() - startMs,
	};
}

/**
 * Builds the sanitized audit record for a thrown provider attempt failure.
 *
 * @param attempt - Provider attempt that failed.
 * @param startMs - Epoch milliseconds when the attempt started.
 * @param error - Thrown value from the attempt.
 * @returns Attempt failure entry for AiRequest metadata.
 */
function providerAttemptFailureFromError(
	attempt: AIProviderAttempt,
	startMs: number,
	error: unknown,
): AIProviderAttemptFailure {
	const details = openAIProviderError(error);

	return providerAttemptFailure(attempt, startMs, details.message, details.status, details.code);
}

/**
 * Merges failed provider attempts onto tracked request metadata for auditing.
 *
 * The caller is responsible for saving the row; complete/fail helpers persist
 * the assignment together with their own fields.
 *
 * @param aiRequest - Tracked request row.
 * @param failures - Failed attempts collected so far.
 */
function attachProviderAttempts(aiRequest: AiRequest, failures: AIProviderAttemptFailure[]): void {
	if (failures.length === 0) return;

	aiRequest.assign({
		metadata: {
			...(aiRequest.metadata ?? {}),
			providerAttempts: failures,
		},
	});
}

/**
 * Detects provider failures that should be retried after a rate-limit reset.
 *
 * @param status - HTTP response status.
 * @param payload - Provider response payload.
 * @returns True when the provider indicates a rate-limit failure.
 */
function isRateLimitFailure(status: number, payload: unknown): boolean {
	if (isOpenAIQuotaError(payload)) return false;

	const code = responseErrorCode(payload);

	return code === 'rate_limit_exceeded' || (status === 429 && code === null);
}

/**
 * Converts a provider rate-limit response into a queue-compatible deferral.
 *
 * @param lease - Active limiter lease, when one exists.
 * @param metadata - Parsed provider response metadata.
 * @param message - Provider error message.
 * @returns Queue retry-later error.
 */
function rateLimitDeferredError(
	lease: AIRateLimitLease | null,
	metadata: AIProviderResponseMetadata,
	message: string,
): AIRateLimitDeferredError {
	return new AIRateLimitDeferredError(
		rateLimitRetryDelaySeconds(metadata),
		lease?.bucketKey ?? 'openai:unknown',
		rateLimitResetAt(metadata),
		message,
	);
}

/**
 * Chooses the latest known reset delay from provider rate-limit headers.
 *
 * @param metadata - Parsed provider response metadata.
 * @returns Delay in whole seconds.
 */
function rateLimitRetryDelaySeconds(metadata: AIProviderResponseMetadata): number {
	const snapshot = metadata.rateLimitSnapshot;
	const resetAfterMs = Math.max(
		0,
		snapshot?.requestsResetAfterMs ?? 0,
		snapshot?.tokensResetAfterMs ?? 0,
		snapshot?.projectTokensResetAfterMs ?? 0,
	);

	return resetAfterMs > 0
		? Math.max(1, Math.ceil(resetAfterMs / 1000))
		: 60;
}

/**
 * Chooses the latest absolute reset time from provider rate-limit headers.
 *
 * @param metadata - Parsed provider response metadata.
 * @returns Reset date or null when unavailable.
 */
function rateLimitResetAt(metadata: AIProviderResponseMetadata): Date | null {
	const snapshot = metadata.rateLimitSnapshot;
	const values = [
		snapshot?.requestsResetAt,
		snapshot?.tokensResetAt,
		snapshot?.projectTokensResetAt,
	]
		.map(value => value ? Date.parse(value) : NaN)
		.filter(value => Number.isFinite(value));

	if (values.length === 0) return null;

	return new Date(Math.max(...values));
}

/**
 * Extract token counts from a Responses API payload.
 */
/**
 * Resolves the exact text-request cost from the provider's trusted source.
 *
 * Official OpenAI requests use the framework model rate card. Providers that
 * resell or dynamically route models must report the amount actually billed;
 * when they omit it, the request remains unpriced instead of using an unsafe
 * model-name estimate.
 *
 * @param provider - Provider that executed the request.
 * @param model - Model recorded for the provider request.
 * @param usage - Normalized provider token usage.
 * @param payload - Raw provider response containing billed-cost extensions.
 * @returns Exact billed cost in USD, or null when it cannot be established.
 */
function textRequestCostUSD(
	provider: AIProvider,
	model: string,
	usage: TokenUsage,
	payload: TextResponsePayloadWithUsage | null,
): number | null {
	if (provider === AI_PROVIDER.openai) {
		return calculateAIRequestCostUSD(model, usage);
	}

	return providerReportedCostUSD(provider, payload);
}

/**
 * Normalizes token usage from a Responses API payload.
 *
 * @param payload - Provider response payload, or null when unavailable.
 * @returns Token counts with absent dimensions preserved as null.
 */
function tokenUsage(payload: TextResponsePayloadWithUsage | null): TokenUsage {
	const usage = asRecord(payload?.usage);
	const inputDetails = asRecord(usage?.input_tokens_details);
	const outputDetails = asRecord(usage?.output_tokens_details);

	return {
		inputTokens: integerValue(usage?.input_tokens),
		outputTokens: integerValue(usage?.output_tokens),
		totalTokens: integerValue(usage?.total_tokens),
		reasoningTokens: integerValue(outputDetails?.reasoning_tokens),
		cachedTokens: integerValue(inputDetails?.cached_tokens),
		cacheWriteTokens: integerValue(inputDetails?.cache_write_tokens),
	};
}

/**
 * Extract token counts from an Embeddings API payload.
 */
function embeddingTokenUsage(payload: EmbeddingResponsePayloadWithUsage | null): TokenUsage {
	const usage = asRecord(payload?.usage);

	return {
		inputTokens: integerValue(usage?.prompt_tokens),
		outputTokens: null,
		totalTokens: integerValue(usage?.total_tokens),
		reasoningTokens: null,
		cachedTokens: null,
		cacheWriteTokens: null,
	};
}

/**
 * Extract token counts from an Images API payload.
 *
 * The current image helper only sends text-to-image generation requests, so
 * aggregate input tokens can be treated as text tokens when modality details are
 * absent. Image output tokens fall back to the aggregate output count because
 * the Images API response payload contains image output only.
 *
 * @param payload - Provider response payload.
 * @returns Normalized token usage for audit and cost calculation.
 */
function imageTokenUsage(payload: ImageResponsePayloadWithUsage | null): ImageTokenUsage {
	const usage = asRecord(payload?.usage);
	const inputDetails = asRecord(usage?.input_tokens_details);
	const outputDetails = asRecord(usage?.output_tokens_details);
	const cachedDetails = asRecord(inputDetails?.cached_tokens_details);
	const inputTokens = integerValue(usage?.input_tokens);
	const outputTokens = integerValue(usage?.output_tokens);
	const cachedTokens = integerValue(inputDetails?.cached_tokens);

	return {
		inputTokens,
		outputTokens,
		totalTokens: integerValue(usage?.total_tokens),
		reasoningTokens: null,
		cachedTokens,
		cacheWriteTokens: null,
		inputTextTokens: integerValue(inputDetails?.text_tokens) ?? inputTokens,
		inputImageTokens: integerValue(inputDetails?.image_tokens) ?? 0,
		outputImageTokens: integerValue(outputDetails?.image_tokens) ?? outputTokens,
		cachedTextTokens: integerValue(inputDetails?.cached_text_tokens) ?? integerValue(cachedDetails?.text_tokens) ?? cachedTokens,
		cachedImageTokens: integerValue(inputDetails?.cached_image_tokens) ?? integerValue(cachedDetails?.image_tokens),
	};
}

/**
 * Store provider metadata without duplicating the full embedding vector.
 */
function compactEmbeddingResponse(payload: EmbeddingResponsePayloadWithUsage | null): Record<string, unknown> | null {
	if (!payload) return null;

	return {
		...payload,
		data: Array.isArray(payload.data)
			? payload.data.map(item => compactEmbeddingDataItem(item))
			: payload.data,
	};
}

/**
 * Replace embedding vectors with their dimensionality for request auditing.
 */
function compactEmbeddingDataItem(item: unknown): Record<string, unknown> {
	const record = asRecord(item) ?? {};
	const embedding = record.embedding;

	return {
		...record,
		embedding: Array.isArray(embedding)
			? {
				dimensions: embedding.length,
			}
			: embedding,
	};
}

/**
 * Extracts the first base64 image payload from an Images API response.
 *
 * @param payload - Provider response payload.
 * @returns Base64 image bytes, or null when unavailable.
 */
function imageBase64(payload: ImageResponsePayloadWithUsage | null): string | null {
	const value = payload?.data?.[0]?.b64_json;

	return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Store image provider metadata without duplicating raw generated bytes.
 *
 * @param payload - Provider response payload.
 * @returns Compact response safe for AiRequest.response.
 */
function compactImageResponse(payload: ImageResponsePayloadWithUsage | null): Record<string, unknown> | null {
	if (!payload) return null;

	return {
		...payload,
		data: Array.isArray(payload.data)
			? payload.data.map(item => compactImageDataItem(item))
			: payload.data,
	};
}

/**
 * Replaces base64 image bytes with byte-count metadata.
 *
 * @param item - Provider image response item.
 * @returns Compact image response item.
 */
function compactImageDataItem(item: unknown): Record<string, unknown> {
	const record = asRecord(item) ?? {};
	const base64 = record.b64_json;

	return {
		...record,
		b64_json: typeof base64 === 'string'
			? {
				encodedLength: base64.length,
			}
			: base64,
	};
}

/**
 * Normalizes caller storage references for JSON-field persistence.
 *
 * @param value - Storage callback result.
 * @returns JSON-safe response value for AiRequest.response.
 */
function imageStoredResponse(value: unknown): unknown {
	if (typeof value === 'string') {
		return {
			path: value,
		};
	}

	return value;
}

/**
 * Extract the provider error code from a failed Responses API payload.
 */
function responseErrorCode(payload: unknown | null): string | null {
	const error = asRecord(asRecord(payload)?.error);
	const code = error?.code;

	return typeof code === 'string' && code.trim() ? code.trim() : null;
}

/**
 * Convert finite numeric token counts to integers and reject all other values.
 */
function integerValue(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;

	return Math.trunc(value);
}

/**
 * Prevents one provider request from being charged both as a child and directly.
 *
 * @param options - Provider request logging and allowance options.
 * @throws {Error} When a child request also supplies an explicit usage charge.
 */
function assertIndependentUsage(options: RequestLogOptions): void {
	if (options.parentAiRequest && options.usage) {
		throw new Error('Nested AI requests cannot carry an independent usage charge.');
	}
}

/**
 * Narrow unknown JSON values to plain object-like records.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object'
		? value as Record<string, unknown>
		: null;
}

/**
 * Safe display message for an unknown thrown value.
 */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected AI request error.';
}

/**
 * Normalize a user record or id into the string id stored on AI rows.
 */
function userRecordId(user: AIRecordIdentity | string | null): string | null {
	if (typeof user === 'string') return user;

	const id = user?.id;

	return id === null || id === undefined ? null : String(id);
}

/**
 * Normalize an application scope record or id into the string id stored on AI rows.
 */
function scopeRecordId(scope: AIRecordIdentity | string | null): string | null {
	if (typeof scope === 'string') return scope;

	const id = scope?.id;

	return id === null || id === undefined ? null : String(id);
}
