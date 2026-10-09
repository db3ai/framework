import { AIProviderDeferredError, AIProviderStoppedError } from './AIProviderAdmission';
import { aiExecutionContext } from './AiExecutionContext';
import { AgentOutputValidationError } from './AgentOutputValidationError';
import { createAgentCompletionDiagnostics, recordAgentCompletion, type AgentCompletionDiagnostics } from './agentCompletionDiagnostics';
import { Agent as SdkAgent, Runner, generateTraceId, type AgentInputItem, type AgentOutputType, type FunctionCallItem, type FunctionCallResultItem, type ModelRequest, type ModelSettings, type RunStreamEvent, type Usage } from '@openai/agents';
import { isQueueRetryLaterError } from '@db3.ai/app/queue';
import type * as queue from '@db3.ai/app/queue';
import type { Serializable, SerializedValueEnvelope } from '@db3.ai/app/serialization';
import { agentMarkdownWithCitations, normalizedAgentCitations, type AgentCitation } from '@db3.ai/pure';
import { app } from '../server/appContext';
import { AiConversation } from './AiConversation';
import { AI_MESSAGE_ROLE, AI_MESSAGE_TOOL_STATE, AiMessage, type AiMessageToolState } from './AiMessage';
import { AI_REQUEST_STATUS, AiRequest } from './AiRequest';
import { AI_PROVIDER, AIQuotaDeferredError, AIRateLimitDeferredError, isFailoverableFailure, openAIProviderError, responsesRateLimitEndpoint, simulatedProviderOutage, type AIProviderAttempt, type AIProviderAttemptFailure, type AIProviderSelection, type AIRateLimitLease } from './index';
import { AIAllowanceExceededError } from './AIErrors.js';
import type { AIUsageCharge } from './contracts/AI';
import { estimateTokensFromText } from './Estimates.js';
import type { AIServiceTier } from './contracts/AIServiceTier';
import { assertAIServiceTier, effectiveAIServiceTier } from './aiServiceTier';
import { calculateAIHostedToolCost, calculateAIRequestCostUSD, calculateAIRequestEntriesCostUSD, combineAIRequestCostUSD, type AIRequestCostUsageEntry } from './modelPricing.js';
import { AgentRunJob } from './AgentRunJob.js';
import { withoutOpenAIQuotaRetryMetadata } from './OpenAIQuotaRetry.js';
import { agentCitationFromStreamRecord, agentCitationsFromFinalModelResponse, rememberAgentCitation } from './agentCitations.js';
import { serializeQueuedAgent } from './registry.js';
import { agentToolResultFromStructuredOutput } from './toolHelpers.js';
import { INTERRUPTED_TOOL_CALL_MESSAGE, unresolvedToolCallIds } from './toolCallRecovery.js';
import type * as agent from './contracts/Agent';

/**
 * Fully prepared run inputs and persistence state ready for SDK execution.
 */
interface PreparedAgentRun {
	/** Tier captured at admission and retained by queued runs. */
	serviceTier: AIServiceTier;
	/** User-visible task message supplied to the agent. */
	message: string;

	/** Provider model selected for this run. */
	model: string;

	/** Trace id used to correlate persisted events and provider tracing. */
	traceId: string;

	/** Previous provider input items from the current conversation before this run. */
	previousMessages: agent.AgentModelInput;

	/** Master application-owned SDK invocation used throughout this prepared run. */
	invocation: PreparedAgentInvocation;

	/** Persisted conversation, request, and per-run state. */
	state: agent.AgentPersistenceState;
}

/**
 * Application-owned values used to create an Agents SDK model invocation.
 *
 * Live execution and request previews share this shape so instructions, input,
 * tools, output type, and model settings cannot drift between the two paths.
 */
interface PreparedAgentInvocation {
	/** Complete system instructions for the model turn. */
	instructions: string;

	/** Complete provider input, including previous messages when present. */
	input: agent.AgentModelInput;

	/** Model settings supplied to the Agents SDK Runner. */
	modelSettings: ModelSettings;

	/** Structured output definition, or null for normal text output. */
	outputType: AgentOutputType | null;

	/** Executable tools configured on the SDK Agent. */
	tools: agent.AgentTool[];

	/** Frontend-safe metadata derived from the executable tools. */
	toolDefinitions: agent.AgentToolDefinition[];
}

/**
 * Context passed into the complete provider-input builder.
 */
export interface AgentInputContext {
	/** Current user or system task message. */
	message: string;

	/** Previous provider-compatible input items in conversation order. */
	previousMessages: agent.AgentModelInput;
}

/**
 * Fluent input payload stored until a stream or queue run starts.
 */
interface AgentRunInputPayload {
	/** User or system task message to run next. */
	message: string;
}

/**
 * Resolved live-stream arguments after applying fluent input shortcuts.
 */
interface ResolvedStreamInput {
	/** Message that should be persisted and sent to the model. */
	message: string;

	/** Event sink used to emit normalized stream events. */
	emit: agent.AgentEventSink;
}

/**
 * Resolved queue arguments after applying fluent input shortcuts.
 */
interface ResolvedQueueInput {
	/** Message that should be persisted and sent to the queued run. */
	message: string;

	/** Queue dispatch options supplied by the caller. */
	options: queue.DispatchOptions;
}

/**
 * Shared persisted Agents SDK runtime for interactive and queued application agents.
 */
export abstract class Agent<TContext extends agent.BaseAgentContext = agent.BaseAgentContext> implements Serializable<TContext> {
	/** Maximum model turns per run; null lets the agent finish without a turn ceiling. */
	protected readonly maxTurns: number | null = 8;
	protected readonly maxPreviousMessages: number = 50;
	/** Provider reasoning effort used for every run of this agent. */
	protected readonly reasoningEffort: agent.AgentReasoningEffort | null = null;
	protected readonly agentName: string = this.constructor.name;
	protected readonly sdkAgentName: string = this.constructor.name;
	protected readonly workflowName: string = this.constructor.name;
	/** Optional agent-specific model. Omit to use the global `app().ai.model`. */
	protected readonly model?: string;
	/** OpenAI processing tier for this agent. Override to opt into local Flex experiments. */
	protected readonly serviceTier: AIServiceTier = 'default';
	private currentInput: AgentRunInputPayload | null = null;

	/**
	 * Creates a persisted agent runtime for the supplied app context.
	 *
	 * @param context - Trusted user, application scope, and optional conversation context.
	 */
	constructor(protected readonly context: TContext) {}

	/**
	 * Returns the complete constructor context for durable agent reconstruction.
	 *
	 * ActiveRecord values are reduced to registered model references by the
	 * framework serializer. Mutable fluent input remains explicit run payload
	 * data and is intentionally not part of constructor state.
	 *
	 * @returns Complete context accepted by this agent's constructor.
	 */
	toJSON(): TContext {
		return this.context;
	}

	/**
	 * Sets the user or task input for the next stream or queued run.
	 *
	 * @param message - User or system task input for the agent.
	 * @returns This agent instance for fluent calls.
	 */
	input(message: string): this {
		this.currentInput = { message };

		return this;
	}

	/**
	 * Runs this agent through a live stream and emits normalized frontend events.
	 *
	 * @param message - Optional user or task input shortcut for this run.
	 * @param emit - Stream event sink used by the HTTP endpoint.
	 * @returns Completed run metadata and final output.
	 */
	async stream(message: string, emit?: agent.AgentEventSink): Promise<agent.AgentRunResult | null>;
	async stream(emit?: agent.AgentEventSink): Promise<agent.AgentRunResult | null>;
	async stream(messageOrEmit?: string | agent.AgentEventSink, emit?: agent.AgentEventSink): Promise<agent.AgentRunResult | null> {
		const streamInput = this.resolveStreamInput(messageOrEmit, emit);
		let state: agent.AgentPersistenceState | null = null;
		const traceId = generateTraceId();

		try {
			const prepared = await this.prepareRun(streamInput.message, 'ndjson', traceId);

			state = prepared.state;

			await streamInput.emit({
				type: 'conversation.created',
				conversationId: String(state.conversation.id),
				aiRequestId: state.aiRequest.id ? String(state.aiRequest.id) : null,
				traceId,
				toolDefinitions: state.toolDefinitions,
			});

			await streamInput.emit({
				type: 'message.created',
				id: String(state.metadata.userMessageId),
				role: 'user',
				content: streamInput.message,
				createdAt: state.metadata.userMessageCreatedAt,
			});

			const result = await this.executePreparedRun(prepared, streamInput.emit);

			await streamInput.emit({
				type: 'run.completed',
				conversationId: result.conversationId,
				aiRequestId: result.aiRequestId,
				traceId,
				usage: result.usage,
				creditCost: result.creditCost,
				...(this.exposeProviderCosts() ? { costUSD: result.costUSD } : {}),
				finalOutput: result.finalOutput,
			});

			return result;
		} catch (error) {
			const payload = agentErrorPayload(error, `Unable to run ${this.agentName}.`);

			if (state) {
				await this.failTrackedRun(state, payload.message);
			}

			await streamInput.emit({
				type: 'run.error',
				conversationId: state?.conversation.id ? String(state.conversation.id) : null,
				aiRequestId: state?.aiRequest.id ? String(state.aiRequest.id) : null,
				traceId,
				error: payload,
			});

			return null;
		}
	}

	/** Runs this agent to completion, preserving the same history and tool lifecycle as stream(). */
	async run(message: string): Promise<agent.AgentRunResult> {
		let failure: string | null = null;
		const result = await this.stream(message, event => { if (event.type === 'run.error') failure = event.error.message; });
		if (!result) throw new Error(failure ?? 'Agent run failed.');
		return result;
	}

	/** Generates and optionally stores an image under the active agent attempt. */
	generateImage<TStored = unknown>(input: import('./contracts/AI').GenerateImageInput, options: import('./contracts/AI').GenerateImageOptions<TStored> = {}) {
		return app().ai.generateImage(input, { user: this.userId(), [app().ai.scopeField]: this.scopeId(), ...options });
	}

	/** Generates an embedding under the active agent attempt. */
	generateEmbedding(input: string, model?: string, options: import('./contracts/AI').RequestLogOptions = {}) {
		return app().ai.generateEmbedding(input, model, { user: this.userId(), [app().ai.scopeField]: this.scopeId(), ...options });
	}

	/** Generates schema-validated output under the active agent attempt. */
	generateStructured<TValue>(input: import('./contracts/AI').GenerateStructuredInput<TValue>, options: import('./contracts/AI').AIResponseLogOptions = {}) {
		return app().ai.generateStructured(input, { user: this.userId(), [app().ai.scopeField]: this.scopeId(), ...options });
	}

	/**
	 * Prepares and dispatches this agent to the queue for background execution.
	 *
	 * @param message - Optional user or task input shortcut for this run.
	 * @param options - Per-dispatch queue options. `options.queue` is the named queue/channel workers listen on, not the payload data.
	 * @returns Queued run identifiers for debug views and polling.
	 */
	async queue(message: string, options?: queue.DispatchOptions): Promise<agent.QueuedAgentRunResponse>;
	async queue(options?: queue.DispatchOptions): Promise<agent.QueuedAgentRunResponse>;
	async queue(messageOrOptions: string | queue.DispatchOptions = {}, options: queue.DispatchOptions = {}): Promise<agent.QueuedAgentRunResponse> {
		const queueInput = this.resolveQueueInput(messageOrOptions, options);
		const traceId = generateTraceId();
		const serializedAgent = await this.serializeForQueue();
		const prepared = await this.prepareRun(queueInput.message, 'queue', traceId);
		const payload = this.queuedRunPayload(prepared, serializedAgent);

		try {
			const jobId = await app().queue.dispatch(new AgentRunJob(payload), queueInput.options);

			await this.markQueued(prepared.state, jobId);

			return {
				jobId,
				conversationId: String(prepared.state.conversation.id),
				aiRequestId: prepared.state.aiRequest.id ? String(prepared.state.aiRequest.id) : null,
				traceId,
			};
		} catch (error) {
			await this.failTrackedRun(prepared.state, error instanceof Error ? error.message : 'Unable to queue agent run.');
			throw error;
		}
	}

	/** Serializes a registered agent before queue preparation creates audit records. */
	protected async serializeForQueue(): Promise<SerializedValueEnvelope> {
		return serializeQueuedAgent(this.agentName, this);
	}

	/**
	 * Resolves the current stream input from the fluent input state or shortcut argument.
	 *
	 * @param messageOrEmit - Optional message shortcut or stream event sink.
	 * @param emit - Optional stream event sink when a message shortcut is supplied.
	 * @returns Resolved message and event sink for this stream run.
	 */
	private resolveStreamInput(messageOrEmit?: string | agent.AgentEventSink, emit?: agent.AgentEventSink): ResolvedStreamInput {
		if (typeof messageOrEmit === 'string') {
			this.input(messageOrEmit);

			return {
				message: this.resolvedInputMessage(),
				emit: emit ?? noopAgentEventSink,
			};
		}

		return {
			message: this.resolvedInputMessage(),
			emit: messageOrEmit ?? noopAgentEventSink,
		};
	}

	/**
	 * Resolves the current queue input from the fluent input state or shortcut argument.
	 *
	 * @param messageOrOptions - Optional message shortcut or dispatch options.
	 * @param options - Optional dispatch options when a message shortcut is supplied.
	 * @returns Resolved message and dispatch options for this queued run.
	 */
	private resolveQueueInput(messageOrOptions: string | queue.DispatchOptions, options: queue.DispatchOptions): ResolvedQueueInput {
		if (typeof messageOrOptions === 'string') {
			this.input(messageOrOptions);

			return {
				message: this.resolvedInputMessage(),
				options,
			};
		}

		return {
			message: this.resolvedInputMessage(),
			options: messageOrOptions,
		};
	}

	/**
	 * Returns the currently configured input message or throws before work starts.
	 *
	 * @returns Current run input message.
	 */
	private resolvedInputMessage(): string {
		if (this.currentInput === null) {
			throw new Error(`${this.agentName} requires input before it can run.`);
		}

		return this.currentInput.message;
	}

	/**
	 * Resumes a prepared queued run from a worker process.
	 *
	 * @param payload - Queued agent run payload.
	 * @returns Completed run metadata and final output.
	 */
	async runQueued(payload: agent.QueuedAgentRunPayload): Promise<agent.AgentRunResult> {
		if (payload.agentName !== this.agentName) {
			throw new Error(`Queued payload for "${payload.agentName}" cannot run on "${this.agentName}".`);
		}

		const prepared = await this.preparedRunFromQueuedPayload(payload);

		try {
			if (recordValue(prepared.state.rootAiRequest.response)?.providerFinalized === true) {
				return await this.resumeFinalizedTrackedRun(prepared);
			}

			return await this.executePreparedRun(prepared, async () => {});
		} catch (error) {
			if (error instanceof AIProviderDeferredError) {
				await this.deferTrackedRun(prepared.state, error);
				throw error;
			}
			if (isQueueRetryLaterError(error)) throw error;
			const providerError = openAIProviderError(error);

			await this.failTrackedRun(
				prepared.state,
				error instanceof Error ? error.message : `Unable to run ${this.agentName}.`,
				providerError.code,
			);
			throw error;
		}
	}

	/**
	 * Resumes only settlement for a queued run whose provider output is durable.
	 *
	 * This closes the credit-settlement/root-save retry window without replaying
	 * model turns, hosted tools, images, or embeddings that already completed.
	 *
	 * @param prepared - Restored queued root with a provider-finalized response.
	 * @returns Completed run result rebuilt from the persisted root response.
	 */
	private async resumeFinalizedTrackedRun(prepared: PreparedAgentRun): Promise<agent.AgentRunResult> {
		const billing = await this.settleFinalizedTrackedRun(prepared.state);
		const response = recordValue(prepared.state.rootAiRequest.response);

		return {
			conversationId: String(prepared.state.conversation.id),
			aiRequestId: prepared.state.rootAiRequest.id ? String(prepared.state.rootAiRequest.id) : null,
			traceId: prepared.traceId,
			usage: billing.usage,
			creditCost: billing.creditCost,
			costUSD: billing.costUSD,
			finalOutput: stringValue(response?.finalOutput) ?? '',
		};
	}

	/**
	 * Returns the SDK tools that should be available for this agent run.
	 *
	 * @returns Agents SDK tools for this agent.
	 */
	protected abstract tools(): agent.AgentTool[];

	/**
	 * Returns the system instructions for this agent.
	 *
	 * @returns Promise resolving to the system instructions sent to the model and persisted for debugging.
	 */
	abstract instructions(): Promise<string>;

	/**
	 * Returns the reasoning summary mode for this agent, or null to keep it off.
	 *
	 * @returns Reasoning summary mode requested from the provider.
	 */
	protected reasoningSummaryMode(): agent.AgentReasoningSummaryMode | null {
		return null;
	}

	/**
	 * Returns a structured output schema for the SDK agent, or null for text output.
	 *
	 * @returns Agent output type used to parse final model output.
	 */
	protected outputType(): AgentOutputType | null {
		return null;
	}

	/**
	 * Converts the SDK final output into the assistant message text stored by application.
	 *
	 * @param finalOutput - Final output returned by the Agents SDK.
	 * @param streamedText - Text accumulated from output deltas while streaming.
	 * @returns Assistant message content to persist and emit.
	 */
	protected finalOutputText(finalOutput: unknown, streamedText: string): string {
		return defaultAgentFinalOutputText(finalOutput, streamedText);
	}

	/**
	 * Performs app-owned side effects after the model has produced a final output.
	 *
	 * @param _state - Active persistence state for the completed run.
	 * @param _finalOutput - Final output returned by the Agents SDK.
	 * @returns Optional metadata to store on the tracked AI response.
	 */
	protected async afterFinalOutput(
		_state: agent.AgentPersistenceState,
		_finalOutput: unknown,
	): Promise<Record<string, unknown> | null> {
		return null;
	}

	/**
	 * Returns structured final output to store on the tracked AI response.
	 *
	 * @param finalOutput - Final output returned by the Agents SDK.
	 * @returns Structured output for audit storage, or undefined for plain text.
	 */
	protected structuredFinalOutput(finalOutput: unknown): unknown | undefined {
		return typeof finalOutput === 'object' && finalOutput !== null ? finalOutput : undefined;
	}

	/**
	 * Builds the complete provider input for a run.
	 *
	 * @param context - Current message and previous provider-shaped input items.
	 * @returns Provider-compatible input items for this run.
	 */
	protected async buildInput(context: AgentInputContext): Promise<agent.AgentModelInput> {
		return [
			...context.previousMessages,
			this.userMessage(context.message),
		];
	}

	/**
	 * Builds a provider-compatible user message.
	 *
	 * @param content - Message text to send as user input.
	 * @returns Agents SDK user message item.
	 */
	protected userMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'user' }> {
		return userInputMessage(content);
	}

	/**
	 * Builds a provider-compatible system message.
	 *
	 * @param content - System context or instruction text.
	 * @returns Agents SDK system message item.
	 */
	protected systemMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'system' }> {
		return systemInputMessage(content);
	}

	/**
	 * Builds a provider-compatible assistant message.
	 *
	 * @param content - Assistant text from an earlier turn.
	 * @returns Agents SDK assistant message item.
	 */
	protected assistantMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'assistant' }> {
		return assistantInputMessage(content);
	}

	/**
	 * Returns lightweight queue metadata used without reconstructing the agent.
	 *
	 * Subclasses should expose only identifiers needed by lifecycle projections.
	 * Constructor state belongs in `toJSON()` and is not duplicated here.
	 *
	 * @returns Application-owned queue lifecycle metadata.
	 */
	protected queueMetadata(): Record<string, string> {
		return {};
	}

	/**
	 * Builds the trace metadata for an SDK runner invocation.
	 *
	 * @param conversation - Conversation attached to the run.
	 * @returns Trace metadata sent to the Agents SDK.
	 */
	protected traceMetadata(conversation: AiConversation): Record<string, string> {
		return {
			app: 'db3',
			agent: this.agentName,
			scopeId: this.scopeId(),
			[`${app().ai.scopeField}Id`]: this.scopeId(),
			conversationId: String(conversation.id),
		};
	}

	/**
	 * Returns additional server-owned values to expose to local tools.
	 *
	 * Subclasses can add task identifiers here when a queued run needs to keep
	 * model-visible tool arguments separate from application-owned boundaries.
	 *
	 * @param _state - Active persistence state, or undefined for a no-run preview.
	 * @returns Additional tool context values.
	 */
	protected toolRunContext(_state?: agent.AgentPersistenceState): Partial<agent.AgentRunContext> {
		return {};
	}

	/**
	 * Returns application-owned metadata that scopes a conversation.
	 *
	 * Values are persisted when a conversation is created and compared again
	 * before later turns are appended, preventing one workflow context from
	 * accidentally continuing inside another.
	 *
	 * @returns Stable conversation-scope metadata for this agent instance.
	 */
	protected conversationMetadata(): Record<string, string | null> {
		return {};
	}

	/**
	 * Returns persisted agent identities permitted to continue this conversation.
	 *
	 * Concrete agents normally accept only their own stable identity. A narrowly
	 * scoped replacement agent may override this hook to continue conversations
	 * created by the exact predecessor it supersedes.
	 *
	 * @returns Persisted agent names accepted by conversation authorization.
	 */
	protected conversationAgentNames(): string[] {
		return [this.agentName];
	}

	/**
	 * Builds the title for a newly created conversation.
	 *
	 * @param message - Initial message for the run.
	 * @returns Compact conversation title.
	 */
	protected conversationTitle(message: string): string {
		const title = message.replace(/\s+/g, ' ').trim();

		if (title.length <= 72) return title || `${this.sdkAgentName} conversation`;

		return `${title.slice(0, 69).trim()}...`;
	}

	/**
	 * Resolves the model used by this agent run.
	 *
	 * @returns Agent-specific model or the global application model.
	 */
	protected resolvedModel(): string {
		return this.model ?? app().ai.model;
	}

	/**
	 * Returns the application credit charge reserved before this agent turn.
	 *
	 * The shared runtime remains unmetered by default because concrete agents
	 * own the product bucket and minimum debit that permits work to begin.
	 * Provider retries reuse the same tracked request id, so allowance adapters
	 * can make repeated checks idempotent.
	 *
	 * @returns Concrete agent charge, or null when funded by another workflow.
	 */
	protected usageCharge(): AIUsageCharge | null {
		return null;
	}

	/**
	 * Returns the billable charge for this invocation.
	 *
	 * Nested agents belong to the outer request tree and therefore cannot
	 * reserve or settle credits independently.
	 *
	 * @returns Top-level product charge, or null for nested and unmetered runs.
	 */
	private billableUsageCharge(): AIUsageCharge | null {
		return this.context.parentAiRequestId ? null : this.usageCharge();
	}

	/**
	 * Returns the model settings shared by live execution and dry-run previews.
	 *
	 * @returns Agents SDK model settings for this agent.
	 */
	protected modelSettings(): ModelSettings {
		const reasoningSummaryMode = this.reasoningSummaryMode();

		return {
			parallelToolCalls: false,
			toolChoice: 'auto',
			...(this.reasoningEffort || reasoningSummaryMode ? {
				reasoning: {
					...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
					...(reasoningSummaryMode ? { summary: reasoningSummaryMode } : {}),
				},
			} : {}),
		};
	}

	/**
	 * Returns the exact first-turn OpenAI Responses request body without calling
	 * OpenAI or creating persistence state.
	 *
	 * The preview enters the same Agents SDK request-preparation path used by a
	 * live run. A request-capturing model stops execution at the provider boundary
	 * before any network transport or tool callback can run.
	 *
	 * @returns JSON request body that would be sent to `responses.create`.
	 *
	 * @example
	 * const request = await agent
	 * 	.input('Complete this task.')
	 * 	.previewRequest();
	 */
	async previewRequest(): Promise<Record<string, unknown>> {
		const model = this.resolvedModel();
		const invocation = await this.prepareAgentInvocation(
			this.resolvedInputMessage(),
			[],
		);

		return openAIResponseRequestBody({
			agent: this.sdkAgent(invocation, model),
			context: this.requestPreviewContext(),
			input: invocation.input,
			maxTurns: this.maxTurns,
			model,
			modelSettings: modelSettingsForProvider(invocation.modelSettings, AI_PROVIDER.openai, this.serviceTier),
		});
	}

	/**
	 * Builds the application-owned values used for one SDK model invocation.
	 *
	 * @param message - Current user or task message.
	 * @param previousMessages - Prior provider-compatible conversation input.
	 * @returns Prepared values shared by live execution and request previews.
	 */
	private async prepareAgentInvocation(
		message: string,
		previousMessages: agent.AgentModelInput,
	): Promise<PreparedAgentInvocation> {
		const tools = this.tools();

		return {
			instructions: await this.instructions(),
			input: await this.buildInput({
				message,
				previousMessages,
			}),
			modelSettings: this.modelSettings(),
			outputType: this.outputType(),
			tools,
			toolDefinitions: agentToolDefinitions(tools),
		};
	}

	/**
	 * Creates the SDK Agent from one shared prepared invocation.
	 *
	 * @param invocation - Application-owned request values.
	 * @param model - Provider model selected for this attempt.
	 * @returns Configured Agents SDK Agent.
	 */
	private sdkAgent(
		invocation: PreparedAgentInvocation,
		model: string,
	): SdkAgent<agent.AgentRunContext, AgentOutputType<unknown>> {
		return new SdkAgent<agent.AgentRunContext, AgentOutputType<unknown>>({
			name: this.sdkAgentName,
			instructions: invocation.instructions,
			model,
			tools: invocation.tools,
			...(invocation.outputType ? { outputType: invocation.outputType } : {}),
		});
	}

	/**
	 * Builds non-persisted SDK context for first-request preparation.
	 *
	 * These runtime-only values are not included in the OpenAI request. They let
	 * the Runner evaluate the same configured tools and dynamic SDK capabilities
	 * without creating a conversation or AI request.
	 *
	 * @returns Tool context used only while the SDK prepares the preview request.
	 */
	private requestPreviewContext(): agent.AgentRunContext {
		return {
			...this.toolRunContext(),
			userId: this.userId(),
			scopeId: this.scopeId(),
			[`${app().ai.scopeField}Id`]: this.scopeId(),
			conversationId: this.context.conversationId || 'request-preview',
			aiRequestId: null,
			rootAiRequestId: null,
			traceId: 'request-preview',
			emitToolProgress: noopAgentEventSink,
		};
	}

	/**
	 * Returns the provider failover selection for this agent's runs.
	 *
	 * Return an ordered provider list to fail over using each provider's default
	 * model, or an ordered provider-to-model record to pin a comparable model per
	 * provider. The agent's reasoning settings apply to every attempt. Null uses
	 * the app default chain, which is OpenAI-only unless configured otherwise.
	 *
	 * @example
	 * protected override provider(): AIProviderSelection {
	 * 	return {
	 * 		[AI_PROVIDER.openai]: this.resolvedModel(),
	 * 		[AI_PROVIDER.openrouter]: 'comparable-model',
	 * 	};
	 * }
	 *
	 * @returns Provider selection for this agent, or null for the app default.
	 */
	protected provider(): AIProviderSelection | null {
		return null;
	}

	/**
	 * Resolves a new or existing conversation and verifies it belongs to this context.
	 *
	 * @param message - Current run message.
	 * @param traceId - Trace id generated for this run.
	 * @param transport - Transport that started the run.
	 * @returns Conversation for the run.
	 */
	private async resolveConversation(message: string, traceId: string, transport: string): Promise<AiConversation> {
		if (this.context.conversationId) {
			const conversation = await app().ai.models.conversation.findOrFail(this.context.conversationId);

			this.assertConversationAccess(conversation);

			return conversation;
		}

		return await new (app().ai.models.conversation)({
			user: this.userId() || null,
			[app().ai.scopeField]: this.scopeId(),
			agent: this.agentName,
			title: this.conversationTitle(message),
			metadata: {
				traceId,
				transport,
				...this.conversationMetadata(),
			},
		}).save();
	}

	/**
	 * Throws when a requested conversation is not owned by this agent context.
	 *
	 * @param conversation - Existing conversation requested by the caller.
	 */
	private assertConversationAccess(conversation: AiConversation): void {
		const conversationUserId = entityRefId(conversation.user);
		const conversationScopeId = entityRefId((conversation as unknown as Record<string, unknown>)[app().ai.scopeField]);

		if ((conversationUserId ?? '') !== this.userId()) {
			throw new AgentAuthorizationError('Permission denied.');
		}

		if ((conversationScopeId ?? '') !== this.scopeId()) {
			throw new AgentAuthorizationError('Permission denied.');
		}

		if (conversation.agent && !this.conversationAgentNames().includes(conversation.agent)) {
			throw new AgentAuthorizationError('Permission denied.');
		}

		for (const [key, expectedValue] of Object.entries(this.conversationMetadata())) {
			const metadata = conversation.metadata ?? {};

			if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;

			const actualValue = metadata[key] ?? null;

			if (actualValue !== expectedValue) {
				throw new AgentAuthorizationError('Permission denied.');
			}
		}
	}

	/**
	 * Prepares conversation, request, and input messages before an SDK run starts.
	 *
	 * @param message - Current run message.
	 * @param transport - Transport that started the run.
	 * @param traceId - Trace id for the run.
	 * @returns Prepared run state ready for stream or queue execution.
	 */
	private async prepareRun(message: string, transport: string, traceId: string): Promise<PreparedAgentRun> {
		const model = this.resolvedModel();
		const conversation = await this.resolveConversation(message, traceId, transport);
		const previousMessages = await this.previousMessages(conversation);
		const invocation = await this.prepareAgentInvocation(message, previousMessages);
		const state = await this.startTrackedRun({
			conversation,
			invocation,
			message,
			model,
			traceId,
			transport,
		});
		const userMessage = await this.saveMessage(state, {
			role: AI_MESSAGE_ROLE.user,
			content: message,
			contentJson: null,
			metadata: {
				eventType: 'user_message',
				traceId,
			},
		});

		state.metadata.userMessageId = String(userMessage.id);
		state.metadata.userMessageCreatedAt = dateString(userMessage.createdAt);

		return {
			message,
			model,
			serviceTier: this.serviceTier,
			traceId,
			previousMessages,
			invocation,
			state,
		};
	}

	/**
	 * Loads a prepared run from a queued payload.
	 *
	 * @param payload - Queued run payload.
	 * @returns Prepared run state for worker execution.
	 */
	private async preparedRunFromQueuedPayload(payload: agent.QueuedAgentRunPayload): Promise<PreparedAgentRun> {
		if (!payload.aiRequestId) {
			throw new Error('Queued agent run is missing an AI request id.');
		}

		const conversation = await app().ai.models.conversation.findOrFail(payload.conversationId);
		const aiRequest = await app().ai.models.request.findOrFail(payload.aiRequestId);

		this.assertConversationAccess(conversation);

		const previousMessages = await this.previousMessages(conversation, aiRequest.id ? String(aiRequest.id) : null);
		const invocation = await this.prepareAgentInvocation(payload.message, previousMessages);

		return {
			message: payload.message,
			model: payload.model,
			serviceTier: payload.serviceTier ?? 'default',
			traceId: payload.traceId,
			previousMessages,
			invocation,
			state: {
				conversation,
				rootAiRequest: aiRequest,
				aiRequest,
				nextSequence: await nextMessageSequence(conversation),
				model: payload.model,
				traceId: payload.traceId,
				startTimeMs: Date.now(),
				metadata: {},
				toolDefinitions: invocation.toolDefinitions,
				hostedToolUsage: {},
				hostedToolCallIds: new Set(),
				citations: [],
				toolArgumentsByCallId: {},
			},
		};
	}

	/**
	 * Executes a prepared SDK run and persists assistant output, tools, and usage.
	 *
	 * @param prepared - Prepared run state.
	 * @param emit - Stream event sink, or a no-op for queued runs.
	 * @returns Completed run metadata.
	 */
	private async executePreparedRun(prepared: PreparedAgentRun, emit: agent.AgentEventSink): Promise<agent.AgentRunResult> {
		const { state } = prepared;
		const invocation = prepared.invocation;
		const instructions = invocation.instructions;
		const modelInput = invocation.input;
		const attempts = app().ai.resolveProviders(this.provider(), prepared.model);
		for (const attempt of attempts) assertAIServiceTier(attempt.provider, prepared.serviceTier);
		const attemptFailures: AIProviderAttemptFailure[] = [];

		await this.attachPromptRequestPayload(state, {
			instructions,
			input: modelInput,
			message: prepared.message,
			previousMessages: prepared.previousMessages,
		});
		await emit(this.promptContextEvent(state, {
			instructions,
			input: modelInput,
			model: prepared.model,
		}));

		for (let index = 0; index < attempts.length; index++) {
			const attempt = attempts[index]!;
			const hasFallback = index < attempts.length - 1;
			const attemptStartMs = Date.now();
			let rateLimitLease: AIRateLimitLease | null = null;
			let sawStreamEvent = false;
			let completedModelTurn = false;
			let activeUsage: Usage | null = null;
			let attemptState: agent.AgentPersistenceState | null = null;
			let attemptSettled = false;
			let providerStarted = false;
			const responsePricing: Array<{ model?: string; serviceTier: string | null }> = [];
			const completion = createAgentCompletionDiagnostics();

			try {
				attemptState = await this.startTrackedAttempt(state, attempt, attemptStartMs, prepared.serviceTier);
				rateLimitLease = await this.acquireProviderCapacity(
					prepared,
					instructions,
					modelInput,
					attempt,
					attemptState,
				);

				const simulatedOutage = simulatedProviderOutage(attempt.provider);

				if (simulatedOutage) throw simulatedOutage;

				const executionState = attemptState;
				return await aiExecutionContext.run(executionState, async () => {
					providerStarted = true;
					const runner = new Runner({
						model: attempt.model,
						modelProvider: app().ai.createAgentProvider(attempt, rateLimitLease, prepared.serviceTier),
						modelSettings: {
							...modelSettingsForProvider(invocation.modelSettings, attempt.provider, prepared.serviceTier),
							retry: {
								maxRetries: 8,
								/** Retains completed tools in this SDK run; never restarts the whole agent. */
								policy: ({ error }) => {
									if (!completedModelTurn) return false;
									const delayMs = app().ai.providerAdmission.requestRetryDelay(attempt, agentRateLimitError(error));
									return delayMs === null ? false : { retry: true, delayMs };
								},
							},
						},
						tracingDisabled: process.env.OPENAI_AGENTS_TRACING_DISABLED === 'true',
						traceIncludeSensitiveData: false,
						workflowName: this.workflowName,
						traceId: prepared.traceId,
						groupId: String(state.conversation.id),
						traceMetadata: this.traceMetadata(state.conversation),
					});
					const sdkAgent = this.sdkAgent(invocation, attempt.model);
					const sdkContext = this.sdkContext(executionState, emit);
					const stream = await runner.run(sdkAgent, modelInput, {
						stream: true,
						context: sdkContext,
						maxTurns: this.maxTurns,
						reasoningItemIdPolicy: 'preserve',
					});

					activeUsage = stream.runContext.usage;
					let assistantText = '';

					for await (const event of stream) {
						sawStreamEvent = true;
						if (event.type === 'raw_model_stream_event' && event.data.type === 'response_done') {
							completedModelTurn = true;
							const providerData = recordValue(event.data.response.providerData);
							recordAgentCompletion(completion, providerData);
							responsePricing.push({
								...(typeof providerData?.model === 'string' ? { model: providerData.model } : {}),
								serviceTier: effectiveAIServiceTier(providerData?.service_tier, prepared.serviceTier),
							});
						}

						const streamEvent = await this.streamEventFromSdkEvent(executionState, event);

						if (!streamEvent) continue;
						if (streamEvent.type === 'tool.calling') completion.toolCalls++;
						if (streamEvent.type === 'tool.success') completion.toolSuccesses++;
						if (streamEvent.type === 'tool.error') completion.toolErrors++;

						if (streamEvent.type === 'text.delta') {
							assistantText += streamEvent.delta;
						}

						await emit(streamEvent);
					}

					await stream.completed;
					const streamFailure = app().ai.providerAdmission?.requestFailure(attempt, null);
					if (streamFailure) throw streamFailure;
					const rawFinalOutput = this.finalOutputText(stream.finalOutput, assistantText);
					const finalResponseCitations = agentCitationsFromFinalModelResponse(stream.rawResponses);
					const citations = finalResponseCitations ?? normalizedAgentCitations(executionState.citations);

					for (const citation of citations) {
						if (!rememberAgentCitation(executionState.citations, citation)) continue;

						await emit({
							type: 'citation.added',
							citation,
						});
					}

					await this.completeTrackedAttempt(
						executionState,
						activeUsage,
						stream.lastResponseId ?? null,
						responsePricing,
						completion,
					);
					attemptSettled = true;

					const structuredOutput = this.structuredFinalOutput(stream.finalOutput);
					const finalOutput = agentMarkdownWithCitations(rawFinalOutput, citations);
					let outputMetadata: Record<string, unknown> | null;
					try {
						outputMetadata = await this.afterFinalOutput(state, stream.finalOutput);
					} catch (error) {
						if (!isQueueRetryLaterError(error)) {
							await executionState.aiRequest.assign({ response: {
								...recordValue(executionState.aiRequest.response),
								outputValidation: { status: 'failed', code: error instanceof AgentOutputValidationError ? error.code : null },
							} }).save();
						}
						throw error;
					}
					const assistantMessage = await this.saveMessage(executionState, {
						role: AI_MESSAGE_ROLE.assistant,
						content: finalOutput,
						contentJson: {
							type: 'assistant_text',
							citations,
						},
						metadata: {
							eventType: 'assistant_message',
							traceId: prepared.traceId,
							lastResponseId: stream.lastResponseId ?? null,
						},
					});
					const billing = await this.completeTrackedRun(state, {
						finalOutput,
						citations,
						lastResponseId: stream.lastResponseId ?? null,
						successfulAttemptAiRequestId: executionState.aiRequest.id ? String(executionState.aiRequest.id) : null,
						structuredOutput,
						outputMetadata,
					});

					await emit({
						type: 'message.completed',
						id: String(assistantMessage.id),
						role: 'assistant',
						content: finalOutput,
						citations,
						createdAt: dateString(assistantMessage.createdAt),
					});

					return {
						conversationId: String(state.conversation.id),
						aiRequestId: state.aiRequest.id ? String(state.aiRequest.id) : null,
						traceId: prepared.traceId,
						usage: billing.usage,
						creditCost: billing.creditCost,
						costUSD: billing.costUSD,
						finalOutput,
					};
				});
			} catch (caught) {
				const restored = agentRateLimitError(caught);
				const failure = app().ai.providerAdmission?.requestFailure(attempt, restored) ?? restored;
				// Restarting a turn after streamed output/tools can repeat completed work.
				const error = failure instanceof AIProviderDeferredError && sawStreamEvent ? new AIProviderStoppedError('outage', failure.providerCode, { ...failure.diagnostics, stopStage: 'stream-output' }) : failure;
				if (failure instanceof AIProviderDeferredError && error instanceof AIProviderStoppedError) error.providerStarted = failure.providerStarted;
				if (attemptState && !attemptSettled) {
					await this.failTrackedAttempt(
						attemptState,
						activeUsage,
						providerStarted,
						error,
						responsePricing,
						completion,
					);
				}

				// Failover is only safe before the SDK has streamed anything: once
				// events arrive, tool calls and partial output may already be
				// persisted or visible, and replaying them would duplicate work.
				if (hasFallback && !sawStreamEvent && isFailoverableFailure(error)) {
					const details = openAIProviderError(error);

					attemptFailures.push({
						provider: attempt.provider,
						model: attempt.model,
						status: details.status,
						code: details.code,
						message: details.message,
						durationMs: Date.now() - attemptStartMs,
					});
					await this.recordProviderAttempts(state, attemptFailures);

					continue;
				}

				throw error;
			} finally {
				await app().ai.releaseRateLimit(rateLimitLease);
			}
		}

		// Unreachable: the final attempt always returns or throws above.
		throw new Error(`Unable to run ${this.agentName}: no provider attempt completed.`);
	}

	/**
	 * Creates the append-only request row for one SDK provider execution attempt.
	 *
	 * The logical root is reused by queue retries, while every provider attempt has
	 * its own immutable cost boundary. Tool children use this attempt as their
	 * parent so replayed or concurrent work cannot overwrite earlier spend.
	 *
	 * @param rootState - Logical run root and shared conversation state.
	 * @param attempt - Provider and model selected for this execution.
	 * @param startedAtMs - Attempt start timestamp in milliseconds.
	 * @param serviceTier - Requested tier retained alongside this attempt.
	 * @returns Persistence state scoped to the new provider attempt.
	 */
	private async startTrackedAttempt(
		rootState: agent.AgentPersistenceState,
		attempt: AIProviderAttempt,
		startedAtMs: number,
		serviceTier: AIServiceTier,
	): Promise<agent.AgentPersistenceState> {
		const aiRequest = await new (app().ai.models.request)({
			conversation: rootState.conversation,
			parentAiRequest: rootState.rootAiRequest,
			user: rootState.rootAiRequest.user,
			[app().ai.scopeField]: (rootState.rootAiRequest as unknown as Record<string, unknown>)[app().ai.scopeField],
			provider: attempt.provider,
			model: attempt.model,
			operation: 'agents.run.attempt',
			status: AI_REQUEST_STATUS.pending,
			request: {
				serviceTier,
				rootAiRequestId: rootState.rootAiRequest.id,
				traceId: rootState.traceId,
			},
			startedAt: new Date(startedAtMs),
			metadata: {
				agent: this.agentName,
				traceId: rootState.traceId,
				outcome: 'provider_attempt',
			},
		}).save();

		return {
			...rootState,
			aiRequest,
			nextSequence: await nextMessageSequence(rootState.conversation),
			model: attempt.model,
			startTimeMs: startedAtMs,
			metadata: { ...rootState.metadata },
			hostedToolUsage: {},
			hostedToolCallIds: new Set(),
			citations: [],
			toolArgumentsByCallId: {},
		};
	}

	/**
	 * Finalizes one successful provider attempt before application side effects run.
	 *
	 * @param state - Attempt-scoped persistence state.
	 * @param sdkUsage - Complete Agents SDK usage for this attempt.
	 * @param lastResponseId - Last provider response id in the attempt.
	 */
	private async completeTrackedAttempt(
		state: agent.AgentPersistenceState,
		sdkUsage: Usage,
		lastResponseId: string | null,
		responsePricing: Array<{ model?: string; serviceTier: string | null }>,
		completion: AgentCompletionDiagnostics,
	): Promise<void> {
		const usage = agentRunUsage(sdkUsage);
		const requestUsageEntries = agentRequestCostUsageEntries(sdkUsage, responsePricing, recordValue(state.aiRequest.request)?.serviceTier);
		const cost = agentAttemptCost(
			state.aiRequest.provider,
			state.model,
			usage,
			requestUsageEntries,
			state.hostedToolUsage,
			recordValue(state.aiRequest.request)?.serviceTier,
		);

		state.aiRequest.assign({
			response: agentAttemptResponse(usage, requestUsageEntries, cost, state.hostedToolUsage, {
				lastResponseId,
				completion,
			}),
			status: AI_REQUEST_STATUS.completed,
			completedAt: new Date(),
			durationMs: Date.now() - state.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD: cost.costUSD,
			knownCostUSD: cost.knownCostUSD,
			errorCode: null,
			errorMessage: null,
		});

		await state.aiRequest.save();
	}

	/**
	 * Finalizes a failed provider attempt with every usage dimension observed.
	 *
	 * @param state - Attempt-scoped persistence state.
	 * @param sdkUsage - Partial SDK usage accumulated before failure.
	 * @param providerStarted - Whether execution crossed the provider boundary.
	 * @param error - Error that ended the attempt.
	 */
	private async failTrackedAttempt(
		state: agent.AgentPersistenceState,
		sdkUsage: Usage | null,
		providerStarted: boolean,
		error: unknown,
		responsePricing: Array<{ model?: string; serviceTier: string | null }>,
		completion: AgentCompletionDiagnostics,
	): Promise<void> {
		const usage = sdkUsage ? agentRunUsage(sdkUsage) : emptyAgentRunUsage();
		const requestUsageEntries = sdkUsage ? agentRequestCostUsageEntries(sdkUsage, responsePricing, recordValue(state.aiRequest.request)?.serviceTier) : [];
		const hasBillableUsage = sdkUsage
			? hasBillableAgentAttemptUsage(sdkUsage, state.hostedToolUsage)
			: Object.values(state.hostedToolUsage).some(count => Number.isFinite(count) && count > 0);
		const cost = hasBillableUsage
			? agentAttemptCost(
				state.aiRequest.provider,
				state.model,
				usage,
				requestUsageEntries,
				state.hostedToolUsage,
				recordValue(state.aiRequest.request)?.serviceTier,
			)
			: emptyAgentAttemptCost(providerStarted);
		const message = error instanceof Error ? error.message : `Unable to run ${this.agentName}.`;

		state.aiRequest.assign({
			response: agentAttemptResponse(usage, requestUsageEntries, cost, state.hostedToolUsage, {
				error: message,
				completion,
			}),
			status: AI_REQUEST_STATUS.failed,
			completedAt: new Date(),
			durationMs: Date.now() - state.startTimeMs,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			totalTokens: usage.totalTokens,
			reasoningTokens: usage.reasoningTokens,
			cachedTokens: usage.cachedTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			costUSD: cost.costUSD,
			knownCostUSD: cost.knownCostUSD,
			errorCode: openAIProviderError(error).code,
			errorMessage: message,
			metadata: {
				...(state.aiRequest.metadata ?? {}),
				outcome: hasBillableUsage ? 'failed_after_provider_usage' : 'failed_without_reported_usage',
				providerStarted,
			},
		});

		await state.aiRequest.save();
	}

	/**
	 * Persists sanitized failed provider attempts for auditing and debugging.
	 *
	 * @param state - Active run persistence state.
	 * @param failures - Failed attempts collected so far.
	 */
	private async recordProviderAttempts(
		state: agent.AgentPersistenceState,
		failures: AIProviderAttemptFailure[],
	): Promise<void> {
		state.aiRequest.assign({
			metadata: {
				...(state.aiRequest.metadata ?? {}),
				providerAttempts: failures,
			},
		});

		await state.aiRequest.save();
	}

	/**
	 * Checks app allowance and reserves capacity for the attempt's first HTTP request.
	 *
	 * @param prepared - Prepared run state with an existing AiRequest row.
	 * @param instructions - System instructions sent to the SDK agent.
	 * @param input - Complete model input for token estimation.
	 * @param attempt - Provider attempt about to run.
	 * @param attemptState - Append-only request row for this provider execution.
	 * @returns Active provider rate-limit lease, or null when rate limiting is disabled.
	 */
	private async acquireProviderCapacity(
		prepared: PreparedAgentRun,
		instructions: string,
		input: AgentInputItem[],
		attempt: AIProviderAttempt,
		attemptState: agent.AgentPersistenceState,
	): Promise<AIRateLimitLease | null> {
		const operation = prepared.state.aiRequest.operation || 'agents.run.stream';
		const estimatedTokens = estimatedAgentRunTokens({ instructions, input });

		await app().ai.checkAllowance({
			provider: attempt.provider,
			endpoint: responsesRateLimitEndpoint(),
			model: attempt.model,
			operation,
			user: this.userId() || null,
			scope: this.scopeId() || null,
			aiRequest: prepared.state.rootAiRequest,
			estimatedTokens,
			usage: this.billableUsageCharge(),
			metadata: {
				agent: this.agentName,
				traceId: prepared.traceId,
				toolNames: prepared.invocation.toolDefinitions.map(tool => tool.name),
			},
		});

		const lease = await app().ai.acquireRateLimit({
			provider: attempt.provider,
			endpoint: responsesRateLimitEndpoint(),
			model: attempt.model,
			operation,
			estimatedTokens,
			aiRequest: attemptState.aiRequest,
		});

		try {
			await this.attachRateLimitBucket(attemptState, lease);
			return lease;
		} catch (error) {
			await app().ai.releaseRateLimit(lease);
			throw error;
		}
	}

	/**
	 * Stores the current provider bucket on the tracked request for audit/debugging.
	 *
	 * @param state - Active run persistence state.
	 * @param lease - Provider rate-limit lease returned by the AI service.
	 */
	private async attachRateLimitBucket(
		state: agent.AgentPersistenceState,
		lease: AIRateLimitLease | null,
	): Promise<void> {
		if (!lease?.bucket) return;

		state.aiRequest.assign({
			rateLimitBucket: lease.bucket,
		});

		await state.aiRequest.save();
	}

	/**
	 * Stores the exact system instructions and built SDK input used for a run.
	 *
	 * @param state - Active run persistence state.
	 * @param input - Prompt data sent to the Agents SDK runner.
	 */
	private async attachPromptRequestPayload(
		state: agent.AgentPersistenceState,
		input: {
			instructions: string;
			input: AgentInputItem[];
			message: string;
			previousMessages: agent.AgentModelInput;
		},
	): Promise<void> {
		state.aiRequest.assign({
			request: {
				...(recordValue(state.aiRequest.request) ?? {}),
				message: input.message,
				previousMessages: input.previousMessages,
				instructions: input.instructions,
				input: input.input,
				prompt: promptMessagesForRequest(input.instructions, input.input),
			},
		});

		await state.aiRequest.save();
	}

	/**
	 * Builds the debug timeline event for the exact prompt sent to the SDK.
	 *
	 * @param state - Active run persistence state.
	 * @param input - System instructions, model input, and model name for the run.
	 * @returns Prompt-context stream event for the frontend timeline.
	 */
	private promptContextEvent(
		state: agent.AgentPersistenceState,
		input: {
			instructions: string;
			input: AgentInputItem[];
			model: string;
		},
	): Extract<agent.AgentStreamEvent, { type: 'prompt.context' }> {
		return {
			type: 'prompt.context',
			id: promptContextId(state.aiRequest.id, state.traceId),
			aiRequestId: state.aiRequest.id ? String(state.aiRequest.id) : null,
			traceId: state.traceId,
			model: input.model,
			createdAt: dateString(state.aiRequest.startedAt ?? state.aiRequest.createdAt),
			userMessageId: state.metadata.userMessageId ?? null,
			messages: promptContextMessages(input.instructions, input.input),
		};
	}

	/**
	 * Creates the pending provider request row and records the system message.
	 *
	 * @param input - Run metadata needed for persistence.
	 * @returns Persistence state for subsequent messages and completion.
	 */
	private async startTrackedRun(input: {
		conversation: AiConversation;
		invocation: PreparedAgentInvocation;
		message: string;
		model: string;
		traceId: string;
		transport: string;
	}): Promise<agent.AgentPersistenceState> {
		const toolDefinitions = input.invocation.toolDefinitions;
		const aiRequest = await new (app().ai.models.request)({
			conversation: input.conversation,
			parentAiRequest: this.context.parentAiRequestId ?? null,
			user: this.userId() || null,
			[app().ai.scopeField]: this.scopeId(),
			provider: AI_PROVIDER.openai,
			model: input.model,
			operation: input.transport === 'queue' ? 'agents.run.queue' : 'agents.run.stream',
			status: AI_REQUEST_STATUS.pending,
			costUSD: 0,
			knownCostUSD: 0,
			request: {
				message: input.message,
				model: input.model,
				tools: toolDefinitions.map(tool => tool.name),
				toolDefinitions,
				traceId: input.traceId,
			},
			metadata: {
				agent: this.agentName,
				traceId: input.traceId,
				transport: input.transport,
			},
			startedAt: new Date(),
		}).save();
		const state: agent.AgentPersistenceState = {
			conversation: input.conversation,
			rootAiRequest: aiRequest,
			aiRequest,
			nextSequence: await nextMessageSequence(input.conversation),
			model: input.model,
			traceId: input.traceId,
			startTimeMs: Date.now(),
			metadata: {},
			toolDefinitions,
			hostedToolUsage: {},
			hostedToolCallIds: new Set(),
			citations: [],
			toolArgumentsByCallId: {},
		};

		await this.saveMessage(state, {
			role: AI_MESSAGE_ROLE.system,
			content: input.invocation.instructions,
			contentJson: null,
			metadata: {
				eventType: 'system_instructions',
				traceId: input.traceId,
			},
		});

		return state;
	}

	/**
	 * Builds the run context object shared with local function tools.
	 *
	 * @param state - Active run persistence state.
	 * @param emit - Stream event sink, or no-op for queued runs.
	 * @returns Agents SDK run context.
	 */
	private sdkContext(state: agent.AgentPersistenceState, emit: agent.AgentEventSink): agent.AgentRunContext {
		return {
			...this.toolRunContext(state),
			userId: this.userId(),
			scopeId: this.scopeId(),
			[`${app().ai.scopeField}Id`]: this.scopeId(),
			conversationId: String(state.conversation.id),
			aiRequestId: state.aiRequest.id ? String(state.aiRequest.id) : null,
			rootAiRequestId: state.rootAiRequest.id ? String(state.rootAiRequest.id) : null,
			traceId: state.traceId,
			emitToolProgress: async progress => {
				await emit({
					type: 'tool.progress',
					id: progress.toolCallId,
					toolName: progress.toolName,
					progress: {
						id: `${progress.toolCallId}:${Date.now()}`,
						message: progress.message,
						current: progress.current,
						total: progress.total,
						data: progress.data,
						createdAt: new Date().toISOString(),
					},
				});
			},
		};
	}

	/**
	 * Converts an Agents SDK stream event into a application frontend stream event.
	 *
	 * @param state - Active run persistence state.
	 * @param event - SDK stream event.
	 * @returns Normalized stream event, or null when the event is not displayed.
	 */
	private async streamEventFromSdkEvent(state: agent.AgentPersistenceState, event: RunStreamEvent): Promise<agent.AgentStreamEvent | null> {
		if (event.type === 'raw_model_stream_event') {
			return await this.rawModelStreamEvent(state, event.data);
		}

		if (event.type !== 'run_item_stream_event') return null;
		if (event.name === 'tool_called') return await this.toolCalledEvent(state, event.item);
		if (event.name === 'tool_output') return await this.toolOutputEvent(state, event.item);
		if (event.name === 'tool_search_called') return await this.toolCalledEvent(state, event.item);
		if (event.name === 'tool_search_output_created') return await this.toolOutputEvent(state, event.item);

		return null;
	}

	/**
	 * Converts raw model stream data into a persisted app stream event.
	 *
	 * @param state - Active run persistence state.
	 * @param data - Raw SDK model stream data.
	 * @returns Normalized stream event, or null when ignored.
	 */
	private async rawModelStreamEvent(state: agent.AgentPersistenceState, data: unknown): Promise<agent.AgentStreamEvent | null> {
		const record = recordValue(data);

		if (!record) return null;

		const citation = agentCitationFromStreamRecord(record);

		if (citation) {
			if (!rememberAgentCitation(state.citations, citation)) return null;

			return {
				type: 'citation.added',
				citation,
			};
		}

		if (record.type === 'response.reasoning_summary_text.done') {
			return await this.reasoningSummaryCompletedEvent(state, record);
		}

		return rawModelStreamRecordEvent(record, state.toolDefinitions);
	}

	/**
	 * Persists a completed reasoning summary and returns its stream event.
	 *
	 * @param state - Active run persistence state.
	 * @param record - Raw Responses reasoning summary completion event.
	 * @returns Reasoning summary completion event, or null when malformed.
	 */
	private async reasoningSummaryCompletedEvent(
		state: agent.AgentPersistenceState,
		record: Record<string, unknown>,
	): Promise<agent.AgentStreamEvent | null> {
		const id = reasoningSummaryEventId(record);
		const text = stringValue(record.text);

		if (!id || !text) return null;

		const message = await this.saveMessage(state, {
			role: AI_MESSAGE_ROLE.system,
			content: text,
			contentJson: {
				type: 'reasoning_summary',
				id,
				text,
			},
			metadata: {
				eventType: 'reasoning_summary',
				traceId: state.traceId,
			},
		});

		return {
			type: 'reasoning.summary.completed',
			id,
			text,
			createdAt: dateString(message.createdAt),
		};
	}

	/**
	 * Persists and emits a tool-call start event.
	 *
	 * @param state - Active run persistence state.
	 * @param item - SDK run item.
	 * @returns Tool calling event or final hosted-tool output event.
	 */
	private async toolCalledEvent(state: agent.AgentPersistenceState, item: unknown): Promise<agent.AgentStreamEvent | null> {
		const rawItem = rawItemFromRunItem(item);
		const toolName = hostedToolNameFromRawItem(rawItem) ?? stringValue(rawItem?.name) ?? 'unknown_tool';
		const callId = toolCallId(rawItem, toolName);
		const argumentsValue = toolArguments(rawItem);
		const toolDefinition = this.toolDefinition(state, toolName);

		rememberToolArguments(state, callId, argumentsValue);

		if (hostedToolCompleted(rawItem)) {
			return await this.toolOutputEvent(state, item);
		}

		await this.saveMessage(state, {
			role: AI_MESSAGE_ROLE.tool,
			content: `${toolName} started.`,
			contentJson: {
				state: AI_MESSAGE_TOOL_STATE.calling,
				arguments: argumentsValue,
			},
			toolCallId: callId,
			toolName,
			toolState: AI_MESSAGE_TOOL_STATE.calling,
			metadata: {
				eventType: 'tool_calling',
				traceId: state.traceId,
			},
		});

		return {
			type: 'tool.calling',
			id: callId,
			toolName,
			arguments: argumentsValue,
			toolDefinition,
		};
	}

	/**
	 * Persists and emits a tool output event.
	 *
	 * @param state - Active run persistence state.
	 * @param item - SDK run item.
	 * @returns Tool success or error event.
	 */
	private async toolOutputEvent(state: agent.AgentPersistenceState, item: unknown): Promise<agent.AgentStreamEvent | null> {
		const rawItem = rawItemFromRunItem(item);
		const output = outputFromRunItem(item, rawItem);
		const hostedToolName = hostedToolNameFromRawItem(rawItem);
		const toolName = hostedToolName ?? stringValue(rawItem?.name) ?? outputToolName(rawItem) ?? 'unknown_tool';
		const callId = toolCallId(rawItem, toolName);
		const argumentsValue = toolOutputArguments(state, callId, toolArguments(rawItem));
		const parsedOutput = parseToolOutput(output);
		const errorMessage = hostedToolErrorMessage(rawItem) ?? toolResultErrorMessage(parsedOutput);
		const toolState = errorMessage ? AI_MESSAGE_TOOL_STATE.error : AI_MESSAGE_TOOL_STATE.success;

		recordHostedToolUsage(state, hostedToolName, callId, rawItem);

		await this.saveMessage(state, {
			role: AI_MESSAGE_ROLE.tool,
			content: errorMessage ? `${toolName} failed.` : `${toolName} completed.`,
			contentJson: {
				state: toolState,
				arguments: argumentsValue,
				result: parsedOutput,
			},
			toolCallId: callId,
			toolName,
			toolState,
			metadata: {
				eventType: errorMessage ? 'tool_error' : 'tool_success',
				traceId: state.traceId,
			},
		});

		if (errorMessage) {
			return {
				type: 'tool.error',
				id: callId,
				toolName,
				arguments: argumentsValue,
				error: {
					message: errorMessage,
					details: parsedOutput,
				},
			};
		}

		return {
			type: 'tool.success',
			id: callId,
			toolName,
			arguments: argumentsValue,
			result: parsedOutput,
		};
	}

	/**
	 * Saves one normalized AI message and increments the persisted sequence.
	 *
	 * @param state - Active run persistence state.
	 * @param input - Message fields to persist.
	 * @returns Persisted message record.
	 */
	private async saveMessage(
		state: agent.AgentPersistenceState,
		input: {
			role: typeof AI_MESSAGE_ROLE[keyof typeof AI_MESSAGE_ROLE];
			content: string | null;
			contentJson: unknown | null;
			toolCallId?: string | null;
			toolName?: string | null;
			toolState?: AiMessageToolState | null;
			metadata: Record<string, unknown> | null;
		},
	): Promise<AiMessage> {
		const message = await new (app().ai.models.message)({
			conversation: state.conversation,
			aiRequest: state.rootAiRequest,
			user: entityRefId(state.rootAiRequest.user),
			[app().ai.scopeField]: entityRefId((state.rootAiRequest as unknown as Record<string, unknown>)[app().ai.scopeField]),
			role: input.role,
			sequence: state.nextSequence,
			content: input.content,
			contentJson: input.contentJson,
			toolCallId: input.toolCallId ?? null,
			toolName: input.toolName ?? null,
			toolState: input.toolState ?? null,
			provider: state.aiRequest.provider ?? AI_PROVIDER.openai,
			model: state.model,
			metadata: input.metadata,
		}).save();

		state.nextSequence += 1;

		return message;
	}

	/**
	 * Stores the provider-finalized logical run and settles its recursive cost tree.
	 *
	 * The attempt row is already durable before this method runs. Persisting the
	 * provider-finalized marker before credit settlement lets a queued retry resume
	 * settlement without making another provider request.
	 *
	 * @param state - Logical root persistence state.
	 * @param input - Final output and successful attempt identity.
	 * @returns Settled application-credit charge and recorded provider cost.
	 */
	private async completeTrackedRun(
		state: agent.AgentPersistenceState,
		input: {
			finalOutput: string;
			citations: AgentCitation[];
			lastResponseId: string | null;
			successfulAttemptAiRequestId: string | null;
			structuredOutput?: unknown;
			outputMetadata?: Record<string, unknown> | null;
		},
	): Promise<{ usage: agent.AgentRunUsage; creditCost: number | null; costUSD: number | null }> {
		const response = {
			finalOutput: input.finalOutput,
			citations: input.citations,
			lastResponseId: input.lastResponseId,
			traceId: state.traceId,
			providerFinalized: true,
			successfulAttemptAiRequestId: input.successfulAttemptAiRequestId,
			...(input.structuredOutput !== undefined ? { structuredOutput: input.structuredOutput } : {}),
			...(input.outputMetadata ? { outputMetadata: input.outputMetadata } : {}),
		};

		state.rootAiRequest.assign({
			response,
			status: AI_REQUEST_STATUS.pending,
			completedAt: null,
			durationMs: Date.now() - state.startTimeMs,
			inputTokens: null,
			outputTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			cacheWriteTokens: null,
			costUSD: 0,
			knownCostUSD: 0,
			errorCode: null,
			errorMessage: null,
			metadata: withoutOpenAIQuotaRetryMetadata(state.rootAiRequest.metadata),
		});

		await state.rootAiRequest.save();

		return await this.settleFinalizedTrackedRun(state);
	}

	/** Controls whether streamed events expose provider costs to this viewer. */
	protected exposeProviderCosts(): boolean { return false; }

	/** Aggregates provider usage; applications may extend this hook to settle their own credit ledger. */
	protected async settleUsage(rootAiRequest: AiRequest, _initialCharge: import('./contracts/AI').AIUsageCharge | null): Promise<{ run: import('./contracts/AiRequestRunCostSummary').AiRequestRunCostSummary; creditCost: number | null }> {
		const run = await app().ai.models.request.runCostSummary(String(rootAiRequest.id));
		if (!run) throw new Error('Tracked AI request tree is missing.');
		return { run, creditCost: null };
	}

	/**
	 * Settles and completes a root whose provider attempts are already durable.
	 *
	 * @param state - Logical root persistence state.
	 * @returns Recursive usage, settled credits, and complete provider cost.
	 */
	private async settleFinalizedTrackedRun(
		state: agent.AgentPersistenceState,
	): Promise<{ usage: agent.AgentRunUsage; creditCost: number | null; costUSD: number | null }> {
		const settlement = await this.settleUsage(state.rootAiRequest, this.billableUsageCharge());
		const run = settlement.run;
		const usage: agent.AgentRunUsage = {
			requests: run.providerRequestCount,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			totalTokens: run.totalTokens,
			reasoningTokens: run.reasoningTokens,
			cachedTokens: run.cachedTokens,
			cacheWriteTokens: run.cacheWriteTokens,
		};
		const response = recordValue(state.rootAiRequest.response) ?? {};
		const lastResponseId = stringValue(response.lastResponseId);

		state.rootAiRequest.assign({
			status: AI_REQUEST_STATUS.completed,
			completedAt: new Date(),
			errorCode: null,
			errorMessage: null,
			costUSD: 0,
			knownCostUSD: 0,
			response: {
				...response,
				usage,
				cost: {
					rootCostUSD: run.rootCostUSD,
					childCostUSD: run.childCostUSD,
					totalCostUSD: run.totalCostUSD,
					requestCount: run.requestCount,
					providerRequestCount: run.providerRequestCount,
					unpricedRequestCount: run.unpricedRequestCount,
					creditCost: settlement.creditCost,
				},
			},
		});

		await state.rootAiRequest.save();
		await this.touchConversation(state, {
			lastTraceId: state.traceId,
			lastResponseId,
			lastStatus: AI_REQUEST_STATUS.completed,
			lastError: null,
			nextRetryAt: null,
			retryUntil: null,
		});

		return {
			usage,
			creditCost: settlement.creditCost,
			costUSD: run.unpricedRequestCount > 0 ? null : run.totalCostUSD,
		};
	}

	/** Keeps unstarted queued work visibly pending on the shared account deadline. */
	private async deferTrackedRun(state: agent.AgentPersistenceState, error: AIProviderDeferredError): Promise<void> {
		state.rootAiRequest.assign({ status: AI_REQUEST_STATUS.pending, completedAt: null, errorCode: 'ai_provider_deferred', errorMessage: error.message,
			metadata: { ...(state.rootAiRequest.metadata ?? {}), providerAdmission: { retryAt: error.retryAt.toISOString(), retryUntil: error.retryUntil.toISOString() } },
		});
		await state.rootAiRequest.save();
		await this.touchConversation(state, { lastTraceId: state.traceId, lastStatus: AI_REQUEST_STATUS.pending, lastError: error.message, nextRetryAt: error.retryAt.toISOString(), retryUntil: error.retryUntil.toISOString() });
	}

	/**
	 * Marks the tracked AI request as failed.
	 *
	 * @param state - Active run persistence state.
	 * @param message - Failure message to persist.
	 * @param errorCode - Provider error code, when available.
	 */
	private async failTrackedRun(
		state: agent.AgentPersistenceState,
		message: string,
		errorCode: string | null = null,
	): Promise<void> {
		state.aiRequest.assign({
			status: AI_REQUEST_STATUS.failed,
			completedAt: new Date(),
			durationMs: Date.now() - state.startTimeMs,
			errorCode,
			errorMessage: message,
			response: {
				...(recordValue(state.aiRequest.response) ?? {}),
				traceId: state.traceId,
				error: message,
			},
		});

		await state.aiRequest.save();
		await this.touchConversation(state, {
			lastTraceId: state.traceId,
			lastStatus: AI_REQUEST_STATUS.failed,
			lastError: message,
			nextRetryAt: null,
		});
	}

	/**
	 * Touches the conversation row so history sorting reflects the latest agent turn.
	 *
	 * Agent-owned scope metadata is reapplied on every update so lifecycle fields
	 * cannot erase the stable identity used by workflow-specific history lookups.
	 *
	 * @param state - Active run persistence state.
	 * @param metadata - Metadata fields to merge onto the conversation.
	 * @returns Nothing after the conversation metadata is persisted.
	 */
	private async touchConversation(state: agent.AgentPersistenceState, metadata: Record<string, unknown>): Promise<void> {
		state.conversation.assign({
			metadata: {
				...(state.conversation.metadata ?? {}),
				...this.conversationMetadata(),
				...metadata,
			},
		});

		await state.conversation.save();
	}

	/**
	 * Loads the previous conversation flow for prompt continuity.
	 *
	 * @param conversation - Conversation to read from.
	 * @param excludeAiRequestId - Current run request id to exclude when a queued run resumes.
	 * @returns Previous turns and tool events in provider-compatible input shape.
	 */
	protected async previousMessages(conversation: AiConversation, excludeAiRequestId: string | null = null): Promise<agent.AgentModelInput> {
		if (!conversation.id) return [];

		const messages = await app().ai.models.message
			.where('conversation', String(conversation.id))
			.orderBy('sequence', 'desc')
			.limit((this.maxPreviousMessages * 2) + 12)
			.all();
		const replayMessages = messages
			.reverse()
			.filter(message => !excludeAiRequestId || entityRefId(message.aiRequest) !== excludeAiRequestId);
		const unresolvedCallIds = unresolvedToolCallIds(replayMessages);
		const seenToolCallIds = new Set<string>();

		return replayMessages
			.flatMap(message => agentInputItemsFromAiMessage(message, seenToolCallIds, unresolvedCallIds))
			.slice(-this.maxPreviousMessages);
	}

	/**
	 * Builds the queue payload for a prepared background run.
	 *
	 * @param prepared - Prepared run state.
	 * @param serializedAgent - Versioned constructor-state envelope.
	 * @returns Queue-safe payload.
	 */
	private queuedRunPayload(
		prepared: PreparedAgentRun,
		serializedAgent: SerializedValueEnvelope,
	): agent.QueuedAgentRunPayload {
		return {
			agentName: this.agentName,
			agent: serializedAgent,
			message: prepared.message,
			metadata: this.queueMetadata(),
			conversationId: String(prepared.state.conversation.id),
			aiRequestId: prepared.state.aiRequest.id ? String(prepared.state.aiRequest.id) : null,
			traceId: prepared.traceId,
			model: prepared.model,
			serviceTier: prepared.serviceTier,
		};
	}

	/**
	 * Stores the queue job id on the pending AI request for debugging.
	 *
	 * @param state - Active run persistence state.
	 * @param jobId - Queue job id returned by the queue driver.
	 */
	private async markQueued(state: agent.AgentPersistenceState, jobId: unknown): Promise<void> {
		state.aiRequest.assign({
			request: {
				...(recordValue(state.aiRequest.request) ?? {}),
				queueJobId: jobId,
			},
			metadata: {
				...(state.aiRequest.metadata ?? {}),
				queueJobId: jobId,
			},
		});

		await state.aiRequest.save();
	}

	/**
	 * Returns the public tool definition for a tool name.
	 *
	 * @param state - Active run carrying metadata derived from its configured tools.
	 * @param toolName - SDK or hosted tool name.
	 * @returns Public tool definition, or null when unavailable.
	 */
	private toolDefinition(state: agent.AgentPersistenceState, toolName: string): agent.AgentToolDefinition | null {
		return state.toolDefinitions.find(definition => definition.name === toolName) ?? null;
	}

	/**
	 * Returns the active user id as a string.
	 *
	 * @returns Active user id, or an empty string when unavailable.
	 */
	protected userId(): string {
		return contextIdentity(this.context.user);
	}

	/**
	 * Returns the active application scope id as a string.
	 *
	 * @returns Active application scope id.
	 */
	protected scopeId(): string {
		return contextIdentity(this.context.scope);
	}
}

/**
 * Restores local capacity deferrals wrapped as connection failures by the SDK.
 *
 * @param error - SDK or application failure from an agent turn.
 * @returns Original limiter deferral, or the unchanged failure for normal handling.
 */
function agentRateLimitError(error: unknown): unknown {
	const seen = new Set<unknown>();
	let current = error;
	while (current instanceof Error && !seen.has(current)) {
		if (isQueueRetryLaterError(current) || current instanceof AIProviderStoppedError) return current;
		seen.add(current);
		current = current.cause;
	}
	return error;
}

/**
 * Builds frontend-safe metadata from the executable tools returned by an agent.
 *
 * @param tools - Executable tools configured for one agent invocation.
 * @returns Serializable definitions in provider tool order.
 */
function agentToolDefinitions(tools: agent.AgentTool[]): agent.AgentToolDefinition[] {
	return tools.map(tool => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
	}));
}

/**
 * Values required to run the real SDK request-preparation path and capture its
 * OpenAI Responses request at the model boundary.
 */
interface OpenAIResponseRequestPreview {
	/** Configured SDK Agent shared with live execution. */
	agent: SdkAgent<agent.AgentRunContext, AgentOutputType<unknown>>;

	/** Non-persisted SDK context used to evaluate request-time capabilities. */
	context: agent.AgentRunContext;

	/** Complete first-turn provider input. */
	input: agent.AgentModelInput;

	/** Maximum turns configured for the live run, or null for no turn ceiling. */
	maxTurns: number | null;

	/** OpenAI model name used for request defaults and the provider body. */
	model: string;

	/** Runner model settings shared with live execution. */
	modelSettings: ModelSettings;
}

/**
 * Captures the exact Responses request prepared by the Agents SDK Runner.
 *
 * The capturing model invokes the OpenAI provider's own request builder and
 * stops before transport. Awaiting the Runner is important because its request
 * preparation includes enabled-tool serialization, output-schema conversion,
 * and model-specific default settings.
 *
 * @param preview - Shared SDK Agent, input, context, and model configuration.
 * @returns JSON-safe `responses.create` request body.
 */
async function openAIResponseRequestBody(
	preview: OpenAIResponseRequestPreview,
): Promise<Record<string, unknown>> {
	const [{ OpenAIResponsesModel }, { default: OpenAI }] = await Promise.all([
		import('@openai/agents'),
		import('openai'),
	]);
	const requestCaptured = new Error('OpenAI request preview captured.');
	let requestBody: Record<string, unknown> | null = null;

	/**
	 * Request-only model that stops before the OpenAI transport call.
	 */
	class OpenAIRequestPreviewModel extends OpenAIResponsesModel {
		/**
		 * Captures the JSON body passed to the OpenAI Responses client.
		 *
		 * @param request - Complete ModelRequest prepared by the SDK Runner.
		 * @returns Async iterable that stops with the private capture sentinel.
		 */
		override async *getStreamedResponse(request: ModelRequest) {
			const built = this._buildResponsesCreateRequest(request, true);

			requestBody = JSON.parse(JSON.stringify(built.requestData)) as Record<string, unknown>;
			throw requestCaptured;
		}
	}

	const previewModel = new OpenAIRequestPreviewModel(
		new OpenAI({ apiKey: 'dry-run-request-preview' }),
		preview.model,
	);
	const runner = new Runner({
		model: preview.model,
		modelProvider: {
			/**
			 * Returns the request-capturing model instead of a transport model.
			 *
			 * @returns OpenAI Responses model that stops before network transport.
			 */
			async getModel() {
				return previewModel;
			},
		},
		modelSettings: preview.modelSettings,
		tracingDisabled: true,
		traceIncludeSensitiveData: false,
	});
	const stream = await runner.run(preview.agent, preview.input, {
		stream: true,
		context: preview.context,
		maxTurns: preview.maxTurns,
		reasoningItemIdPolicy: 'preserve',
	});

	try {
		await stream.completed;
	} catch (error) {
		if (error !== requestCaptured) throw error;
	}

	if (requestBody === null) {
		throw new Error('The Agents SDK did not prepare an OpenAI request preview.');
	}

	return requestBody;
}

/**
 * Accepts stream events when the caller does not need live output.
 */
async function noopAgentEventSink(): Promise<void> {}

/**
 * Raised when a user asks for an inaccessible agent conversation.
 */
export class AgentAuthorizationError extends Error {
	/**
	 * Creates an agent authorization error.
	 *
	 * @param message - Public error message.
	 */
	constructor(message: string) {
		super(message);
		this.name = 'AgentAuthorizationError';
	}
}

/**
 * Returns the next message sequence for a conversation.
 *
 * @param conversation - Conversation to append to.
 * @returns Next message sequence number.
 */
async function nextMessageSequence(conversation: AiConversation): Promise<number> {
	if (!conversation.id) return 1;

	const lastMessage = await app().ai.models.message
		.where('conversation', String(conversation.id))
		.orderBy('sequence', 'desc')
		.first();

	return (lastMessage?.sequence ?? 0) + 1;
}

/**
 * Normalizes link-field entity refs to their string id.
 *
 * @param value - Unknown entity reference value.
 * @returns Entity id string or null.
 */
function entityRefId(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;

	const id = (value as { id?: unknown }).id;

	return id === null || id === undefined ? null : String(id);
}

/**
 * Converts raw model stream records into text, reasoning, or hosted-tool events.
 *
 * @param record - Raw SDK model stream record.
 * @param toolDefinitions - Public tool definitions available to the active agent.
 * @returns Normalized stream event, or null when ignored.
 */
function rawModelStreamRecordEvent(record: Record<string, unknown>, toolDefinitions: agent.AgentToolDefinition[]): agent.AgentStreamEvent | null {
	if (record.type === 'response.reasoning_summary_text.delta') {
		const id = reasoningSummaryEventId(record);
		const delta = stringValue(record.delta);

		return id && delta ? { type: 'reasoning.summary.delta', id, delta } : null;
	}

	if (record.type !== 'response.output_text.delta' && record.type !== 'output_text_delta') {
		return rawHostedToolStreamEvent(record, toolDefinitions);
	}

	const delta = stringValue(record.delta);

	return delta ? { type: 'text.delta', delta } : null;
}

/**
 * Builds a stable timeline id for one reasoning summary stream item.
 *
 * @param record - Raw Responses reasoning summary stream event.
 * @returns Stable summary id, or null when the event has no item id.
 */
function reasoningSummaryEventId(record: Record<string, unknown>): string | null {
	const itemId = stringValue(record.item_id) || stringValue(record.itemId);
	const summaryIndex = typeof record.summary_index === 'number' ? record.summary_index : record.summaryIndex;

	if (!itemId) return null;

	return `${itemId}:${typeof summaryIndex === 'number' ? summaryIndex : 0}`;
}

/**
 * Converts raw Responses hosted-tool lifecycle events into tool-card updates.
 *
 * @param record - Raw hosted-tool stream record.
 * @param toolDefinitions - Public tool definitions available to the active agent.
 * @returns Normalized stream event, or null when ignored.
 */
function rawHostedToolStreamEvent(
	record: Record<string, unknown>,
	toolDefinitions: agent.AgentToolDefinition[],
): agent.AgentStreamEvent | null {
	const eventType = stringValue(record.type);
	const outputItem = recordValue(record.item);
	const outputItemToolName = hostedToolNameFromRawItem(outputItem);

	if (eventType === 'response.output_item.added' && outputItemToolName) {
		return {
			type: 'tool.calling',
			id: rawHostedToolItemCallId(outputItem, outputItemToolName),
			toolName: outputItemToolName,
			arguments: rawHostedToolItemArguments(outputItem),
			toolDefinition: toolDefinitions.find(definition => definition.name === outputItemToolName) ?? null,
		};
	}

	if (eventType === 'response.output_item.done' && outputItemToolName) {
		const callId = rawHostedToolItemCallId(outputItem, outputItemToolName);
		const status = stringValue(outputItem?.status);

		if (status === 'failed' || status === 'incomplete') {
			return {
				type: 'tool.error',
				id: callId,
				toolName: outputItemToolName,
				arguments: rawHostedToolItemArguments(outputItem),
				error: {
					message: `${outputItemToolName} ${status}.`,
					details: outputItem,
				},
			};
		}

		return {
			type: 'tool.success',
			id: callId,
			toolName: outputItemToolName,
			arguments: rawHostedToolItemArguments(outputItem),
			result: outputItem,
		};
	}

	const toolName = hostedToolNameFromRawEvent(eventType);

	if (!eventType || !toolName) return null;

	const callId = rawHostedToolCallId(record, toolName);
	const result = rawHostedToolResult(record);

	if (eventType.endsWith('.completed')) {
		return {
			type: 'tool.success',
			id: callId,
			toolName,
			result,
		};
	}

	if (eventType.endsWith('.failed')) {
		return {
			type: 'tool.error',
			id: callId,
			toolName,
			error: {
				message: 'The hosted tool failed.',
				details: result,
			},
		};
	}

	if (eventType.endsWith('.in_progress')) {
		return {
			type: 'tool.calling',
			id: callId,
			toolName,
			arguments: rawHostedToolArguments(record),
			toolDefinition: toolDefinitions.find(definition => definition.name === toolName) ?? null,
		};
	}

	return {
		type: 'tool.progress',
		id: callId,
		toolName,
		progress: {
			id: `${callId}:${eventType}`,
			message: rawHostedToolProgressMessage(eventType),
			data: rawHostedToolProgressData(record),
			createdAt: new Date().toISOString(),
		},
	};
}

/**
 * Extracts the raw model item from an Agents SDK run item.
 *
 * @param item - SDK run item.
 * @returns Raw model item record or null.
 */
function rawItemFromRunItem(item: unknown): Record<string, unknown> | null {
	const record = recordValue(item);

	return recordValue(record?.rawItem);
}

/**
 * Extracts a tool output payload from an Agents SDK run item.
 *
 * @param item - SDK run item.
 * @param rawItem - Raw model item record.
 * @returns Tool output payload.
 */
function outputFromRunItem(item: unknown, rawItem: Record<string, unknown> | null): unknown {
	const record = recordValue(item);

	if (record && 'output' in record && record.output !== undefined && record.output !== null) return record.output;
	if (rawItem && 'output' in rawItem && rawItem.output !== undefined && rawItem.output !== null) return rawItem.output;
	if (rawItem?.providerData) return rawItem.providerData;
	return rawItem;
}

/**
 * Returns a stable id for a tool call.
 *
 * @param rawItem - Raw SDK item.
 * @param fallback - Fallback id when the SDK item has no id.
 * @returns Stable tool call id.
 */
function toolCallId(rawItem: Record<string, unknown> | null, fallback: string): string {
	return stringValue(rawItem?.callId) || stringValue(rawItem?.call_id) || stringValue(rawItem?.id) || fallback;
}

/**
 * Reads the tool name from a function-call result when available.
 *
 * @param rawItem - Raw SDK item.
 * @returns Tool name or null.
 */
function outputToolName(rawItem: Record<string, unknown> | null): string | null {
	return stringValue(rawItem?.name);
}

/**
 * Extracts the best available tool arguments for local and hosted tool calls.
 *
 * @param rawItem - Raw SDK item.
 * @returns Tool arguments.
 */
function toolArguments(rawItem: Record<string, unknown> | null): unknown {
	const providerData = recordValue(rawItem?.providerData);
	const providerAction = providerData?.action ?? providerData?.query ?? providerData?.queries;

	return parseToolArguments(rawItem?.arguments ?? providerAction ?? {});
}

/**
 * Remembers non-empty tool arguments from the call item for later output items.
 *
 * @param state - Active run persistence state.
 * @param callId - Stable tool call id.
 * @param value - Parsed argument payload from the SDK item.
 */
function rememberToolArguments(state: agent.AgentPersistenceState, callId: string, value: unknown): void {
	if (!hasToolArguments(value)) return;

	state.toolArgumentsByCallId[callId] = value;
}

/**
 * Returns output-item arguments, falling back to the matching call item.
 *
 * @param state - Active run persistence state.
 * @param callId - Stable tool call id.
 * @param value - Parsed output item argument payload.
 * @returns Best available arguments for the tool call.
 */
function toolOutputArguments(state: agent.AgentPersistenceState, callId: string, value: unknown): unknown {
	if (hasToolArguments(value)) {
		state.toolArgumentsByCallId[callId] = value;

		return value;
	}

	return state.toolArgumentsByCallId[callId] ?? value;
}

/**
 * Returns true when a parsed argument payload carries model-provided input.
 *
 * @param value - Parsed argument payload.
 * @returns True when the payload should replace existing arguments.
 */
function hasToolArguments(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (Array.isArray(value)) return value.length > 0;

	const record = recordValue(value);

	if (record) return Object.keys(record).length > 0;

	return true;
}

/**
 * Parses a tool-call arguments value when the SDK supplies JSON text.
 *
 * @param value - Unknown arguments value.
 * @returns Parsed arguments value.
 */
function parseToolArguments(value: unknown): unknown {
	if (typeof value !== 'string') return value ?? {};

	return parseJson(value) ?? value;
}

/**
 * Parses a function-tool output value into the result shape returned by the tool.
 *
 * @param value - Unknown tool output value.
 * @returns Parsed tool output value.
 */
function parseToolOutput(value: unknown): unknown {
	const structuredResult = agentToolResultFromStructuredOutput(value);

	if (structuredResult !== null) return structuredResult;
	if (typeof value !== 'string') return value;

	return parseJson(value) ?? value;
}

/**
 * Returns a tool-level error message when the tool result reports one.
 *
 * @param value - Parsed tool output value.
 * @returns Error message or null.
 */
function toolResultErrorMessage(value: unknown): string | null {
	const record = recordValue(value);

	if (record?.status !== 'error') return null;

	return stringValue(record.message) ?? 'The tool failed.';
}

/**
 * Returns a hosted-tool error when the provider marks the call as failed.
 *
 * @param rawItem - Raw SDK item.
 * @returns Hosted tool error message or null.
 */
function hostedToolErrorMessage(rawItem: Record<string, unknown> | null): string | null {
	const status = stringValue(rawItem?.status);

	if (status !== 'failed' && status !== 'incomplete') return null;

	return `${stringValue(rawItem?.name) ?? 'Hosted tool'} ${status}.`;
}

/**
 * Returns true when a hosted tool call item already contains its final status.
 *
 * @param rawItem - Raw SDK item.
 * @returns True when the hosted tool has completed.
 */
function hostedToolCompleted(rawItem: Record<string, unknown> | null): boolean {
	const status = rawItem?.status;

	return hostedToolNameFromRawItem(rawItem) !== null
		&& (status === 'completed' || status === 'failed' || status === 'incomplete');
}

/**
 * Maps raw Responses hosted-tool event names to the normalized tool name.
 *
 * @param eventType - Raw event type.
 * @returns Hosted tool name or null.
 */
function hostedToolNameFromRawEvent(eventType: string | null): string | null {
	if (!eventType) return null;
	if (eventType.startsWith('response.web_search_call.')) return 'web_search_call';
	if (eventType.startsWith('response.image_generation_call.')) return 'image_generation_call';

	return null;
}

/**
 * Maps raw Responses output items to hosted tool names.
 *
 * @param item - Raw output item.
 * @returns Hosted tool name or null.
 */
function hostedToolNameFromRawItem(item: Record<string, unknown> | null): string | null {
	const type = stringValue(item?.type);

	if (type === 'web_search_call') return 'web_search_call';
	if (type === 'image_generation_call') return 'image_generation_call';
	if (type === 'hosted_tool_call') return stringValue(item?.name);

	return null;
}

/**
 * Records one completed hosted provider-tool call on the active request.
 *
 * Web searches are recorded only for `search` actions because page opens are
 * included in history but are not separate billable calls. Other hosted tools
 * are retained so the pricing layer can either price them or mark the request
 * incomplete instead of silently omitting a provider charge.
 *
 * @param state - Active run persistence state.
 * @param toolName - Normalized hosted tool name.
	 * @param callId - Stable provider call id used to prevent duplicate billing.
 * @param rawItem - Completed raw provider tool item.
 */
function recordHostedToolUsage(
	state: agent.AgentPersistenceState,
	toolName: string | null,
	callId: string,
	rawItem: Record<string, unknown> | null,
): void {
	if (!toolName) return;
	if (state.hostedToolCallIds.has(callId)) return;

	if (toolName === 'web_search_call') {
		const providerData = recordValue(rawItem?.providerData);
		const action = recordValue(rawItem?.action) ?? recordValue(providerData?.action);

		if (stringValue(action?.type) !== 'search') return;
	}

	state.hostedToolCallIds.add(callId);
	state.hostedToolUsage[toolName] = (state.hostedToolUsage[toolName] ?? 0) + 1;
}

/**
 * Extracts a stable hosted-tool call id from a raw Responses output item.
 *
 * @param item - Raw output item.
 * @param toolName - Hosted tool name.
 * @returns Stable tool call id.
 */
function rawHostedToolItemCallId(item: Record<string, unknown> | null, toolName: string): string {
	return stringValue(item?.id) || stringValue(item?.call_id) || stringValue(item?.callId) || toolName;
}

/**
 * Extracts hosted-tool arguments from a raw Responses output item.
 *
 * @param item - Raw output item.
 * @returns Hosted tool arguments.
 */
function rawHostedToolItemArguments(item: Record<string, unknown> | null): unknown {
	return recordValue(item?.action) ?? item?.query ?? item?.queries ?? {};
}

/**
 * Extracts a stable hosted-tool call id from a raw Responses stream event.
 *
 * @param record - Raw stream event.
 * @param toolName - Hosted tool name.
 * @returns Stable tool call id.
 */
function rawHostedToolCallId(record: Record<string, unknown>, toolName: string): string {
	return stringValue(record.item_id)
		|| stringValue(record.itemId)
		|| stringValue(record.id)
		|| `${toolName}:${String(record.output_index ?? record.sequence_number ?? 'active')}`;
}

/**
 * Extracts hosted-tool arguments from a raw Responses stream event.
 *
 * @param record - Raw stream event.
 * @returns Hosted tool arguments.
 */
function rawHostedToolArguments(record: Record<string, unknown>): unknown {
	return recordValue(record.action) ?? recordValue(record.query) ?? {};
}

/**
 * Builds a compact hosted-tool result payload for raw completed events.
 *
 * @param record - Raw stream event.
 * @returns Compact hosted-tool result.
 */
function rawHostedToolResult(record: Record<string, unknown>): unknown {
	const item = recordValue(record.item);

	return item ?? compactHostedToolRecord(record);
}

/**
 * Builds compact progress data for hosted tools without large binary previews.
 *
 * @param record - Raw stream event.
 * @returns Compact progress data.
 */
function rawHostedToolProgressData(record: Record<string, unknown>): Record<string, unknown> {
	const data = compactHostedToolRecord(record);

	if ('partial_image_b64' in record) {
		data.hasPartialImage = true;
	}

	return data;
}

/**
 * Returns a user-facing hosted-tool progress message.
 *
 * @param eventType - Raw hosted-tool event type.
 * @returns Human-readable progress message.
 */
function rawHostedToolProgressMessage(eventType: string): string {
	if (eventType.includes('.searching')) return 'Searching the web';
	if (eventType.includes('.generating')) return 'Generating image';
	if (eventType.includes('.partial_image')) return 'Receiving image preview';

	return 'Using hosted tool';
}

/**
 * Copies safe scalar hosted-tool fields for progress and generic result views.
 *
 * @param record - Raw hosted-tool record.
 * @returns Compact record without large binary fields.
 */
function compactHostedToolRecord(record: Record<string, unknown>): Record<string, unknown> {
	const compact: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(record)) {
		if (key === 'partial_image_b64') continue;
		if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
			compact[key] = value;
		}
	}

	return compact;
}

/**
 * Parses JSON and returns null when the input is not valid JSON.
 *
 * @param value - JSON string to parse.
 * @returns Parsed value or null.
 */
function parseJson(value: string): unknown | null {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

/**
 * Creates a provider-compatible user message.
 *
 * @param content - Message text to send as user input.
 * @returns Agents SDK user message item.
 */
function userInputMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'user' }> {
	return {
		type: 'message',
		role: AI_MESSAGE_ROLE.user,
		content,
	};
}

/**
 * Creates a provider-compatible assistant message from persisted text.
 *
 * @param content - Assistant text stored from an earlier run.
 * @returns Agents SDK assistant message item.
 */
function assistantInputMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'assistant' }> {
	return {
		type: 'message',
		role: AI_MESSAGE_ROLE.assistant,
		status: 'completed',
		content: [
			{
				type: 'output_text',
				text: content,
			},
		],
	};
}

/**
 * Creates a provider-compatible system message for debug snapshots.
 *
 * @param content - System instruction text.
 * @returns Agents SDK system message item.
 */
function systemInputMessage(content: string): Extract<agent.AgentModelInputMessage, { role: 'system' }> {
	return {
		type: 'message',
		role: AI_MESSAGE_ROLE.system,
		content,
	};
}

/**
 * Converts one persisted conversation row into SDK input items.
 *
 * Tool result rows require a matching call item. When the original call row is
 * outside the replay window, the result row carries enough normalized data to
 * synthesize the call immediately before the result.
 *
 * @param message - Persisted conversation row.
 * @param seenToolCallIds - Tool call ids already emitted into the replay input.
 * @param unresolvedCallIds - Calls that have no persisted terminal result.
 * @returns Provider-compatible input items for the row.
 */
function agentInputItemsFromAiMessage(
	message: AiMessage,
	seenToolCallIds: Set<string>,
	unresolvedCallIds: Set<string>,
): AgentInputItem[] {
	if (message.role === AI_MESSAGE_ROLE.assistant) {
		return [assistantInputMessage(message.content ?? '')];
	}

	if (message.role === AI_MESSAGE_ROLE.user) {
		return [userInputMessage(message.content ?? '')];
	}

	if (message.role === AI_MESSAGE_ROLE.tool) {
		return toolInputItemsFromAiMessage(message, seenToolCallIds, unresolvedCallIds);
	}

	return [];
}

/**
 * Converts one persisted tool timeline row into SDK function-call input items.
 *
 * @param message - Persisted tool message.
 * @param seenToolCallIds - Tool call ids already emitted into the replay input.
 * @param unresolvedCallIds - Calls that have no persisted terminal result.
 * @returns Provider-compatible function call and result items for the row.
 */
function toolInputItemsFromAiMessage(
	message: AiMessage,
	seenToolCallIds: Set<string>,
	unresolvedCallIds: Set<string>,
): AgentInputItem[] {
	const content = recordValue(message.contentJson);
	const state = persistedToolState(message, content);
	const toolName = message.toolName || stringValue(content?.toolName);
	const callId = message.toolCallId || stringValue(content?.callId) || stringValue(content?.call_id);
	const argumentsValue = content?.arguments ?? {};

	if (!state || !toolName || !callId) return [];

	if (state === AI_MESSAGE_TOOL_STATE.calling) {
		seenToolCallIds.add(callId);

		return unresolvedCallIds.has(callId)
			? [
				toolCallInputItem(toolName, callId, argumentsValue),
				interruptedToolResultInputItem(toolName, callId),
			]
			: [toolCallInputItem(toolName, callId, argumentsValue)];
	}

	const items: AgentInputItem[] = [];

	if (!seenToolCallIds.has(callId)) {
		items.push(toolCallInputItem(toolName, callId, argumentsValue));
		seenToolCallIds.add(callId);
	}

	items.push(toolResultInputItem(toolName, callId, state, content, message));

	return items;
}

/**
 * Reads the normalized lifecycle state from a persisted tool row.
 *
 * @param message - Persisted tool message.
 * @param content - Parsed tool message payload.
 * @returns Normalized tool state, or null when unsupported.
 */
function persistedToolState(message: AiMessage, content: Record<string, unknown> | null): AiMessageToolState | null {
	const state = message.toolState ?? stringValue(content?.state);

	if (
		state === AI_MESSAGE_TOOL_STATE.calling
		|| state === AI_MESSAGE_TOOL_STATE.success
		|| state === AI_MESSAGE_TOOL_STATE.error
	) {
		return state;
	}

	return null;
}

/**
 * Builds the SDK input item representing a previous model tool call.
 *
 * @param name - Tool name shown to the model.
 * @param callId - Provider call id that links the call to its result.
 * @param argumentsValue - Tool arguments supplied by the model.
 * @returns Function-call input item accepted by the Agents SDK.
 */
function toolCallInputItem(name: string, callId: string, argumentsValue: unknown): FunctionCallItem {
	return {
		type: 'function_call',
		callId,
		name,
		status: 'completed',
		arguments: serializedToolArguments(argumentsValue),
	};
}

/**
 * Builds the SDK input item representing a previous tool result.
 *
 * @param name - Tool name shown to the model.
 * @param callId - Provider call id that links the result to its call.
 * @param state - Persisted tool completion state.
 * @param content - Parsed persisted tool payload.
 * @param message - Persisted tool message.
 * @returns Function-result input item accepted by the Agents SDK.
 */
function toolResultInputItem(
	name: string,
	callId: string,
	state: AiMessageToolState,
	content: Record<string, unknown> | null,
	message: AiMessage,
): FunctionCallResultItem {
	return {
		type: 'function_call_result',
		name,
		callId,
		status: 'completed',
		output: serializedToolOutput(name, state, content, message),
	};
}

/**
 * Builds a synthetic result that closes an interrupted persisted function call.
 *
 * The result is supplied only to future model turns. The tool is not executed
 * again automatically because a partially completed tool may have side effects.
 *
 * @param name - Persisted function tool name.
 * @param callId - Provider call id that must receive a matching output.
 * @returns Provider-compatible error result for the interrupted call.
 */
function interruptedToolResultInputItem(name: string, callId: string): FunctionCallResultItem {
	return {
		type: 'function_call_result',
		name,
		callId,
		status: 'completed',
		output: serializedToolValue({
			status: 'error',
			message: INTERRUPTED_TOOL_CALL_MESSAGE,
		}),
	};
}

/**
 * Serializes model-provided tool arguments for SDK replay.
 *
 * @param value - Persisted arguments payload.
 * @returns JSON argument string expected by function-call items.
 */
function serializedToolArguments(value: unknown): string {
	if (typeof value === 'string') return value;

	return serializedToolValue(value ?? {});
}

/**
 * Serializes stored tool output for SDK replay.
 *
 * @param name - Tool name used for fallback error text.
 * @param state - Persisted tool completion state.
 * @param content - Parsed persisted tool payload.
 * @param message - Persisted tool message.
 * @returns Tool output string for a function-result item.
 */
function serializedToolOutput(
	name: string,
	state: AiMessageToolState,
	content: Record<string, unknown> | null,
	message: AiMessage,
): string {
	const result = content && 'result' in content ? content.result : message.content ?? '';

	if (state === AI_MESSAGE_TOOL_STATE.error) {
		return serializedToolValue({
			status: 'error',
			message: message.content || `${name} failed.`,
			result,
		});
	}

	return serializedToolValue(result);
}

/**
 * Safely serializes a tool payload for model replay and debug display.
 *
 * @param value - Tool payload to serialize.
 * @returns JSON text, plain string value, or a string fallback.
 */
function serializedToolValue(value: unknown): string {
	if (typeof value === 'string') return value;

	try {
		return JSON.stringify(value ?? {});
	} catch {
		return String(value);
	}
}

/**
 * Builds the complete debug prompt array stored with an AI request.
 *
 * @param instructions - System instructions configured on the SDK agent.
 * @param input - Provider-compatible runner input.
 * @returns Prompt messages for request auditing.
 */
function promptMessagesForRequest(instructions: string, input: AgentInputItem[]): AgentInputItem[] {
	return [
		systemInputMessage(instructions),
		...input,
	];
}

/**
 * Builds frontend prompt-context messages from provider-compatible input items.
 *
 * @param instructions - System instructions configured on the SDK agent.
 * @param input - Provider-compatible runner input.
 * @returns Role-tagged text messages for the debug UI.
 */
function promptContextMessages(instructions: string, input: AgentInputItem[]): agent.AgentPromptContextMessage[] {
	return promptMessagesForRequest(instructions, input)
		.map(promptContextMessageFromInputItem)
		.filter((message): message is agent.AgentPromptContextMessage => message !== null);
}

/**
 * Converts one SDK input item into a prompt-context text message when possible.
 *
 * @param item - Provider-compatible input item.
 * @returns Frontend prompt-context message, or null for unsupported items.
 */
function promptContextMessageFromInputItem(item: AgentInputItem): agent.AgentPromptContextMessage | null {
	const record = recordValue(item);

	if (!record) return null;

	const toolMessage = promptContextMessageFromToolItem(record);

	if (toolMessage) return toolMessage;

	const role = record?.role;

	if (
		role !== AI_MESSAGE_ROLE.system
		&& role !== AI_MESSAGE_ROLE.user
		&& role !== AI_MESSAGE_ROLE.assistant
		&& role !== AI_MESSAGE_ROLE.tool
	) {
		return null;
	}

	const content = inputContentText(record.content);

	if (content === null) return null;

	return {
		role,
		content,
	};
}

/**
 * Converts SDK tool input items into readable prompt-context messages.
 *
 * @param item - Provider-compatible tool input item.
 * @returns Tool prompt-context message, or null when the item is not a tool.
 */
function promptContextMessageFromToolItem(item: Record<string, unknown>): agent.AgentPromptContextMessage | null {
	const type = item.type;

	if (type === 'function_call') {
		const name = stringValue(item.name) || 'unknown_tool';

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Tool call: ${name}`,
				`Call ID: ${stringValue(item.callId) || stringValue(item.call_id) || 'unknown'}`,
				'Arguments:',
				promptPayloadText(item.arguments),
			].join('\n'),
		};
	}

	if (type === 'function_call_result') {
		const name = stringValue(item.name) || 'unknown_tool';

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Tool result: ${name}`,
				`Call ID: ${stringValue(item.callId) || stringValue(item.call_id) || 'unknown'}`,
				'Output:',
				promptPayloadText(item.output),
			].join('\n'),
		};
	}

	if (type === 'hosted_tool_call') {
		const name = stringValue(item.name) || 'hosted_tool';
		const output = item.output === undefined ? null : ['Output:', promptPayloadText(item.output)].join('\n');

		return {
			role: AI_MESSAGE_ROLE.tool,
			content: [
				`Hosted tool: ${name}`,
				`Status: ${stringValue(item.status) || 'unknown'}`,
				'Arguments:',
				promptPayloadText(item.arguments),
				output,
			].filter((line): line is string => line !== null).join('\n'),
		};
	}

	return null;
}

/**
 * Converts provider message content into readable text for debugging.
 *
 * @param value - String or content-part array from an SDK message.
 * @returns Readable text, or null when no text can be extracted.
 */
function inputContentText(value: unknown): string | null {
	if (typeof value === 'string') return value;

	if (!Array.isArray(value)) return null;

	const text = value
		.map(inputContentPartText)
		.filter((part): part is string => part !== null)
		.join('\n');

	return text || null;
}

/**
 * Converts one provider content part into readable text.
 *
 * @param value - Unknown content part.
 * @returns Text extracted from the content part, or null when unsupported.
 */
function inputContentPartText(value: unknown): string | null {
	const part = recordValue(value);

	if (!part) return null;
	if (typeof part.text === 'string') return part.text;
	if (typeof part.refusal === 'string') return part.refusal;
	if (typeof part.transcript === 'string') return part.transcript;

	return null;
}

/**
 * Converts an arbitrary prompt payload into readable debug text.
 *
 * @param value - Unknown prompt payload.
 * @returns Human-readable prompt payload text.
 */
function promptPayloadText(value: unknown): string {
	const content = inputContentText(value);

	if (content !== null) return prettyJsonText(content);

	if (value === undefined) return '{}';

	return prettyJsonText(value);
}

/**
 * Pretty-prints JSON strings and objects without truncating prompt content.
 *
 * @param value - Unknown payload value.
 * @returns Readable JSON or scalar text.
 */
function prettyJsonText(value: unknown): string {
	if (typeof value === 'string') {
		const parsed = parseJson(value);

		if (parsed !== null) return prettyJsonText(parsed);

		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/**
 * Estimates the provider token cost for a full agent run before usage is known.
 *
 * @param input - System instructions and complete SDK input.
 * @returns Non-zero token estimate for rate-limit reservations.
 */
function estimatedAgentRunTokens(input: { instructions: string; input: AgentInputItem[] }): number {
	const text = [
		input.instructions,
		...promptContextMessages('', input.input).map(message => message.content),
	].join('\n');

	return estimateTokensFromText(text);
}

/**
 * Converts the SDK final output value into text for persistence and display.
 *
 * @param finalOutput - SDK final output.
 * @param streamedText - Text collected from streaming deltas.
 * @returns Final output text.
 */
function defaultAgentFinalOutputText(finalOutput: unknown, streamedText: string): string {
	if (typeof finalOutput === 'string' && finalOutput.trim()) return finalOutput;

	return streamedText.trim();
}

/**
 * Converts SDK usage into the app's normalized usage summary.
 *
 * @param usage - Agents SDK usage object.
 * @returns Normalized usage summary.
 */
function agentRunUsage(usage: Usage): agent.AgentRunUsage {
	return {
		requests: usage.requests,
		inputTokens: numberOrNull(usage.inputTokens),
		outputTokens: numberOrNull(usage.outputTokens),
		totalTokens: numberOrNull(usage.totalTokens),
		reasoningTokens: sumTokenDetails(usage.outputTokensDetails, 'reasoning_tokens'),
		cachedTokens: sumTokenDetails(usage.inputTokensDetails, 'cached_tokens'),
		cacheWriteTokens: sumTokenDetails(usage.inputTokensDetails, 'cache_write_tokens'),
	};
}

/**
 * Normalizes the SDK's individual provider-request usage for accurate pricing.
 *
 * @param usage - Agents SDK aggregate usage object.
 * @param responsePricing - Terminal response metadata in SDK request order.
 * @param requestedTier - Saved selection used only for legacy Standard fallback.
 * @returns Individual request entries with cached-input details preserved.
 */
function agentRequestCostUsageEntries(usage: Usage, responsePricing: Array<{ model?: string; serviceTier: string | null }>, requestedTier: unknown): AIRequestCostUsageEntry[] {
	return (usage.requestUsageEntries ?? []).map((entry, index) => ({
		...(responsePricing.length === usage.requestUsageEntries?.length ? responsePricing[index] : { serviceTier: effectiveAIServiceTier(undefined, requestedTier) }),
		inputTokens: numberOrNull(entry.inputTokens),
		outputTokens: numberOrNull(entry.outputTokens),
		cachedTokens: tokenDetailValue(entry.inputTokensDetails, 'cached_tokens'),
		cacheWriteTokens: tokenDetailValue(entry.inputTokensDetails, 'cache_write_tokens'),
		...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
	}));
}

/** Cost completeness and priced portions for one append-only agent attempt. */
interface AgentAttemptCost {
	/** Model-token cost, or null when provider usage cannot be priced safely. */
	modelCostUSD: number | null;
	/** Known hosted provider-tool fees. */
	hostedToolCostUSD: number;
	/** Hosted tools without a trusted local pricing rule. */
	unpricedHostedToolUsage: Record<string, number>;
	/** Known provider-cost subtotal retained even when the complete cost is unavailable. */
	knownCostUSD: number;
	/** Complete attempt cost, or null when any billable portion is unknown. */
	costUSD: number | null;
	/** Usage basis used for model-token pricing. */
	pricingUsage: 'per_request' | 'single_request_aggregate' | 'known_zero' | 'unpriced_incomplete';
}

/**
 * Prices one agent attempt only when its provider and usage granularity are safe.
 *
 * Long-context and cache-write charges apply per provider request. Multiple SDK
 * requests therefore require a complete request-usage entry set; aggregate
 * fallback is accepted only for exactly one request.
 *
 * @param provider - Provider that executed the attempt.
 * @param model - Provider model used by the attempt.
 * @param usage - Aggregate attempt usage.
 * @param requestUsageEntries - Per-provider-request usage entries.
 * @param hostedToolUsage - Completed hosted provider-tool calls.
 * @param requestedTier - Saved selection used for single-request Standard fallback.
 * @returns Complete attempt cost and any unpriced dimensions.
 */
function agentAttemptCost(
	provider: string | null,
	model: string,
	usage: agent.AgentRunUsage,
	requestUsageEntries: AIRequestCostUsageEntry[],
	hostedToolUsage: Record<string, number>,
	requestedTier: unknown,
): AgentAttemptCost {
	const usesPerRequestUsage = usage.requests > 0
		&& requestUsageEntries.length === usage.requests;
	const usesSingleRequestAggregate = usage.requests === 1
		&& requestUsageEntries.length === 0;
	const modelCostUSD = provider === AI_PROVIDER.openai
		? usesPerRequestUsage
			? calculateAIRequestEntriesCostUSD(model, requestUsageEntries)
			: usesSingleRequestAggregate
				? calculateAIRequestCostUSD(model, { ...usage, serviceTier: effectiveAIServiceTier(undefined, requestedTier) })
				: null
		: null;
	const hostedToolCost = provider === AI_PROVIDER.openai
		? calculateAIHostedToolCost(hostedToolUsage)
		: {
			costUSD: 0,
			unpricedUsage: normalizedHostedToolUsage(hostedToolUsage),
		};
	const knownCostUSD = combineAIRequestCostUSD(modelCostUSD ?? 0, hostedToolCost.costUSD) ?? 0;
	const costUSD = Object.keys(hostedToolCost.unpricedUsage).length === 0
		? combineAIRequestCostUSD(modelCostUSD, hostedToolCost.costUSD)
		: null;

	return {
		modelCostUSD,
		hostedToolCostUSD: hostedToolCost.costUSD,
		unpricedHostedToolUsage: hostedToolCost.unpricedUsage,
		knownCostUSD,
		costUSD,
		pricingUsage: provider !== AI_PROVIDER.openai
			? 'unpriced_incomplete'
			: usesPerRequestUsage
				? 'per_request'
				: usesSingleRequestAggregate
					? 'single_request_aggregate'
					: 'unpriced_incomplete',
	};
}

/**
 * Normalizes completed hosted-tool counts when provider-specific pricing is absent.
 *
 * @param usage - Hosted-tool counts observed during one provider attempt.
 * @returns Positive whole call counts that must remain explicitly unpriced.
 */
function normalizedHostedToolUsage(usage: Record<string, number>): Record<string, number> {
	const normalized: Record<string, number> = {};

	for (const [toolName, count] of Object.entries(usage)) {
		if (!Number.isFinite(count) || count <= 0) continue;

		normalized[toolName] = Math.trunc(count);
	}

	return normalized;
}

/**
 * Returns a cost result for an attempt with no observed billable usage.
 *
 * @param providerStarted - Whether execution may have crossed the provider boundary.
 * @returns Confirmed zero before provider work, otherwise an unknown cost.
 */
function emptyAgentAttemptCost(providerStarted: boolean): AgentAttemptCost {
	return {
		modelCostUSD: providerStarted ? null : 0,
		hostedToolCostUSD: 0,
		unpricedHostedToolUsage: {},
		knownCostUSD: 0,
		costUSD: providerStarted ? null : 0,
		pricingUsage: providerStarted ? 'unpriced_incomplete' : 'known_zero',
	};
}

/**
 * Builds the persisted response payload for one provider attempt.
 *
 * @param usage - Normalized aggregate usage.
 * @param requestUsageEntries - Per-provider-request usage entries.
 * @param cost - Complete and partial cost result.
 * @param hostedToolUsage - Completed hosted provider-tool counts.
 * @param metadata - Attempt result fields such as response id or error.
 * @returns Auditable attempt response without raw model content.
 */
function agentAttemptResponse(
	usage: agent.AgentRunUsage,
	requestUsageEntries: AIRequestCostUsageEntry[],
	cost: AgentAttemptCost,
	hostedToolUsage: Record<string, number>,
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...metadata,
		usage,
		cost: {
			modelCostUSD: cost.modelCostUSD,
			hostedToolCostUSD: cost.hostedToolCostUSD,
			unpricedHostedToolUsage: cost.unpricedHostedToolUsage,
			knownCostUSD: cost.knownCostUSD,
			requestCostUSD: cost.costUSD,
			hostedToolUsage,
			pricingUsage: cost.pricingUsage,
			requestUsageEntries,
		},
	};
}

/**
 * Returns the absence-preserving usage shape for an attempt without SDK usage.
 *
 * @returns Empty usage with no invented provider token counts.
 */
function emptyAgentRunUsage(): agent.AgentRunUsage {
	return {
		requests: 0,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
		cacheWriteTokens: null,
	};
}

/**
 * Applies the explicitly selected service tier only to direct OpenAI requests.
 *
 * @param settings - Agent-owned model settings.
 * @param provider - Provider selected for the current attempt.
 * @param serviceTier - Explicit class selection, frozen in queued run payloads.
 * @returns Provider-safe settings with the selected OpenAI tier.
 */
function modelSettingsForProvider(settings: ModelSettings, provider: string, serviceTier: AIServiceTier): ModelSettings {
	assertAIServiceTier(provider, serviceTier);
	if (provider !== AI_PROVIDER.openai) return settings;

	return {
		...settings,
		providerData: {
			...(settings.providerData ?? {}),
			service_tier: serviceTier,
		},
	};
}

/**
 * Checks whether a failed agent attempt accumulated any potentially billable work.
 *
 * @param usage - Mutable Agents SDK usage collected during the attempt.
 * @param hostedToolUsage - Completed hosted provider-tool calls for the attempt.
 * @returns True when a failed-attempt child request should preserve usage.
 */
function hasBillableAgentAttemptUsage(
	usage: Usage,
	hostedToolUsage: Record<string, number>,
): boolean {
	return usage.requests > 0
		|| usage.inputTokens > 0
		|| usage.outputTokens > 0
		|| Object.values(hostedToolUsage).some(count => Number.isFinite(count) && count > 0);
}

/**
 * Sums one token detail field across the SDK's aggregate detail records.
 *
 * @param details - Usage detail records.
 * @param key - Detail key to sum.
 * @returns Total when positive, otherwise null.
 */
function sumTokenDetails(details: Array<Record<string, number>>, key: string): number | null {
	const total = details.reduce((sum, detail) => {
		const value = detail[key];

		return typeof value === 'number' && Number.isFinite(value) ? sum + value : sum;
	}, 0);

	return total > 0 ? total : null;
}

/**
 * Reads one token detail from an individual SDK request usage entry.
 *
 * @param details - Provider request token-detail record.
 * @param key - Detail key to read.
 * @returns Non-negative integer detail value, or null when absent.
 */
function tokenDetailValue(details: Record<string, number>, key: string): number | null {
	const value = details[key];

	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? Math.trunc(value)
		: null;
}

/**
 * Normalizes finite numbers while preserving unknown usage values as null.
 *
 * @param value - Numeric usage value.
 * @returns Integer usage value or null.
 */
function numberOrNull(value: number): number | null {
	return Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Creates the public agent error payload for stream errors.
 *
 * @param error - Unknown error value.
 * @param fallback - Fallback public error message.
 * @returns Public stream error payload.
 */
function agentErrorPayload(error: unknown, fallback: string): agent.AgentToolErrorPayload {
	return {
		code: error instanceof AIAllowanceExceededError ? error.publicCode : undefined,
		message: error instanceof Error && error.message ? error.message : fallback,
		details: error instanceof AgentAuthorizationError ? undefined : errorDetails(error),
	};
}

/**
 * Returns safe developer-facing error details without including secrets.
 *
 * @param error - Unknown error value.
 * @returns Safe error details.
 */
function errorDetails(error: unknown): unknown {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
		};
	}

	return error;
}

/**
 * Safely narrows unknown values to object records.
 *
 * @param value - Unknown value.
 * @returns Object record or null.
 */
function recordValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/**
 * Returns a string value when the unknown input is a non-empty string.
 *
 * @param value - Unknown value.
 * @returns String value or null.
 */
function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Builds a stable frontend id for a prompt-context timeline item.
 *
 * @param aiRequestId - Persisted AI request id when available.
 * @param traceId - Provider trace id used as a fallback.
 * @returns Prompt-context timeline id.
 */
function promptContextId(aiRequestId: unknown, traceId: string): string {
	const id = aiRequestId === null || aiRequestId === undefined ? traceId : String(aiRequestId);

	return `prompt_context:${id}`;
}

/**
 * Serializes dates for stream events.
 *
 * @param value - Date value to serialize.
 * @returns ISO timestamp.
 */
function dateString(value: Date | null): string {
	return value instanceof Date ? value.toISOString() : new Date().toISOString();
}

/** Normalizes a trusted app context identity without requiring a particular user or tenant model. */
function contextIdentity(value: { id: unknown } | string | null | undefined): string {
	if (typeof value === 'string') return value;
	return value?.id == null ? '' : String(value.id);
}
