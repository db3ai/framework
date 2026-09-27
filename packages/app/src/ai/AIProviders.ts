import type { AIProviderConfig, AIProviderAttempt, AIProviderAttemptFailure, ResolvedOpenAIConnection, ResolveProviderChainInput } from './contracts/Providers';
export type { AIProviderConfig, AIProviderAttempt, AIProviderAttemptFailure, ResolvedOpenAIConnection, ResolveProviderChainInput } from './contracts/Providers';
import { AI_PROVIDER, type AIProvider, type AIProviderSelection } from './contracts/AI.js';
import { AIConfigurationError } from './AIErrors.js';

const AI_PROVIDER_CONFIG: Record<AIProvider, AIProviderConfig> = {
	[AI_PROVIDER.openai]: {
		apiKeyEnv: 'OPENAI_API_KEY',
		baseUrlEnv: 'OPENAI_BASE_URL',
		modelEnv: null,
		defaultBaseUrl: 'https://api.openai.com/v1',
		supportsResponsesApi: true,
	},
	[AI_PROVIDER.openrouter]: {
		apiKeyEnv: 'OPENROUTER_API_KEY',
		baseUrlEnv: 'OPENROUTER_BASE_URL',
		modelEnv: 'OPENROUTER_MODEL',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		supportsResponsesApi: true,
	},
	[AI_PROVIDER.groq]: {
		apiKeyEnv: 'GROQ_API_KEY',
		baseUrlEnv: 'GROQ_BASE_URL',
		modelEnv: 'GROQ_MODEL',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		supportsResponsesApi: false,
	},
	[AI_PROVIDER.xai]: {
		apiKeyEnv: 'XAI_API_KEY',
		baseUrlEnv: 'XAI_BASE_URL',
		modelEnv: 'XAI_MODEL',
		defaultBaseUrl: 'https://api.x.ai/v1',
		supportsResponsesApi: false,
	},
	[AI_PROVIDER.deepseek]: {
		apiKeyEnv: 'DEEPSEEK_API_KEY',
		baseUrlEnv: 'DEEPSEEK_BASE_URL',
		modelEnv: 'DEEPSEEK_MODEL',
		defaultBaseUrl: 'https://api.deepseek.com/v1',
		supportsResponsesApi: false,
	},
};

/**
 * Resolves an ordered provider selection into fully configured attempts.
 *
 * Providers without an API key, or non-OpenAI providers without a model, are
 * skipped so a half-configured backup can never break the primary path. The
 * OpenAI entry keeps using the AI service's resolved key, base URL, and model.
 *
 * @param input - Selection plus the resolved OpenAI connection.
 * @returns Ordered attempts to try in sequence.
 * @throws AIConfigurationError when no provider in the selection is usable.
 */
export function resolveProviderChain(input: ResolveProviderChainInput): AIProviderAttempt[] {
	const entries = normalizeSelection(input.selection);
	const disabled = providerListFromEnvironment('AI_PROVIDER_DISABLED');
	const attempts: AIProviderAttempt[] = [];
	let sawDisabled = false;

	for (const [provider, model] of entries) {
		if (disabled.includes(provider)) {
			sawDisabled = true;

			continue;
		}

		const attempt = resolveAttempt(provider, model, input.openai);

		if (attempt) attempts.push(attempt);
	}

	if (attempts.length === 0) {
		throw new AIConfigurationError(sawDisabled
			? 'No usable AI provider remains: every provider in the selection is disabled by AI_PROVIDER_DISABLED or unconfigured.'
			: undefined);
	}

	return attempts;
}

/**
 * Reads the app-wide default provider chain from AI_PROVIDER_CHAIN.
 *
 * @returns Ordered provider list, or null when the variable is unset.
 * @throws AIConfigurationError when the variable names an unknown provider.
 */
export function providerChainFromEnvironment(): AIProvider[] | null {
	const chain = providerListFromEnvironment('AI_PROVIDER_CHAIN');

	return chain.length > 0 ? chain : null;
}

/**
 * Returns a synthetic failoverable outage for providers listed in AI_PROVIDER_OUTAGE.
 *
 * This is a development and testing toggle: listed providers stay in the
 * resolved chain but every attempt fails immediately with a 503-style error
 * that the failover classifier treats as failoverable. That exercises the real
 * failover path, attempt auditing, and terminal behavior when no backup is
 * configured. Use AI_PROVIDER_DISABLED instead to skip a provider entirely.
 *
 * @param provider - Provider about to be attempted.
 * @returns Error to throw in place of the provider call, or null.
 */
export function simulatedProviderOutage(provider: AIProvider): Error | null {
	if (!providerListFromEnvironment('AI_PROVIDER_OUTAGE').includes(provider)) return null;

	return Object.assign(new Error(`Simulated outage for AI provider ${provider} (AI_PROVIDER_OUTAGE).`), {
		code: 'service_unavailable',
		status: 503,
	});
}

/**
 * Parses a comma-separated provider list environment variable.
 *
 * @param name - Environment variable name.
 * @returns Ordered provider list, empty when the variable is unset.
 * @throws AIConfigurationError when the variable names an unknown provider.
 */
function providerListFromEnvironment(name: string): AIProvider[] {
	const value = process.env[name]?.trim();

	if (!value) return [];

	return value.split(',').map(part => {
		const provider = part.trim();

		if (!isKnownProvider(provider)) {
			throw new AIConfigurationError(`Unknown AI provider "${provider}" in ${name}.`);
		}

		return provider;
	});
}

/**
 * Normalizes any selection shape into ordered provider/model pairs.
 *
 * @param selection - Provider selection, or null for the OpenAI default.
 * @returns Ordered pairs where a null model means "use the provider default".
 * @throws AIConfigurationError when the selection names an unknown provider.
 */
function normalizeSelection(selection: AIProviderSelection | null): Array<[AIProvider, string | null]> {
	if (!selection) return [[AI_PROVIDER.openai, null]];

	if (typeof selection === 'string') {
		assertKnownProvider(selection);

		return [[selection, null]];
	}

	if (Array.isArray(selection)) {
		if (selection.length === 0) return [[AI_PROVIDER.openai, null]];

		return selection.map(provider => {
			assertKnownProvider(provider);

			return [provider, null];
		});
	}

	const entries = Object.entries(selection) as Array<[string, string]>;

	if (entries.length === 0) return [[AI_PROVIDER.openai, null]];

	return entries.map(([provider, model]) => {
		assertKnownProvider(provider);

		return [provider, model];
	});
}

/**
 * Resolves credentials and model for one provider entry.
 *
 * @param provider - Known provider id.
 * @param model - Explicit model from a record selection, or null.
 * @param openai - Resolved OpenAI connection for the openai entry.
 * @returns Configured attempt, or null when the provider is not usable.
 */
function resolveAttempt(
	provider: AIProvider,
	model: string | null,
	openai: ResolvedOpenAIConnection,
): AIProviderAttempt | null {
	const config = AI_PROVIDER_CONFIG[provider];
	const isOpenAI = provider === AI_PROVIDER.openai;
	const apiKey = isOpenAI ? openai.apiKey : (process.env[config.apiKeyEnv] ?? '');
	const baseUrl = isOpenAI
		? openai.baseUrl
		: (process.env[config.baseUrlEnv] || config.defaultBaseUrl).replace(/\/+$/g, '');
	const resolvedModel = model
		|| (isOpenAI ? openai.model : (config.modelEnv ? process.env[config.modelEnv] : undefined))
		|| null;

	if (!apiKey || !resolvedModel) return null;

	return {
		provider,
		model: resolvedModel,
		apiKey,
		baseUrl,
		supportsResponsesApi: config.supportsResponsesApi,
	};
}

/**
 * Narrows an arbitrary string to a known provider id.
 *
 * @param value - Candidate provider id.
 * @returns True when the value is a registered provider.
 */
function isKnownProvider(value: string): value is AIProvider {
	return Object.prototype.hasOwnProperty.call(AI_PROVIDER_CONFIG, value);
}

/**
 * Throws a configuration error for unknown provider ids in a selection.
 *
 * @param value - Candidate provider id.
 */
function assertKnownProvider(value: string): asserts value is AIProvider {
	if (!isKnownProvider(value)) {
		throw new AIConfigurationError(`Unknown AI provider "${value}" in provider selection.`);
	}
}
