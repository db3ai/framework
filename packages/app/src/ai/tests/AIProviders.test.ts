import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ai as AI } from '@db3.ai/app/ai';
import { AIConfigurationError } from '@db3.ai/app/ai';
import { providerChainFromEnvironment, resolveProviderChain, simulatedProviderOutage } from '@db3.ai/app/ai';

const openai = {
	apiKey: 'openai-key',
	baseUrl: 'https://api.openai.com/v1',
	model: 'gpt-test',
};

describe('resolveProviderChain', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('defaults to a single OpenAI attempt', () => {
		expect(resolveProviderChain({
			selection: null,
			openai,
		})).toEqual([
			{
				provider: 'openai',
				model: 'gpt-test',
				apiKey: 'openai-key',
				baseUrl: 'https://api.openai.com/v1',
				supportsResponsesApi: true,
			},
		]);
	});

	it('uses each provider default model for plain provider lists', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');
		vi.stubEnv('OPENROUTER_MODEL', 'router-default-model');

		expect(resolveProviderChain({
			selection: ['openai', 'openrouter'],
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openai',
				model: 'gpt-test',
				apiKey: 'openai-key',
			}),
			expect.objectContaining({
				provider: 'openrouter',
				model: 'router-default-model',
				apiKey: 'router-key',
				baseUrl: 'https://openrouter.ai/api/v1',
			}),
		]);
	});

	it('pins provider models from ordered record selections', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');

		expect(resolveProviderChain({
			selection: {
				openrouter: 'comparable-mini',
				openai: 'gpt-5.4-mini',
			},
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openrouter',
				model: 'comparable-mini',
			}),
			expect.objectContaining({
				provider: 'openai',
				model: 'gpt-5.4-mini',
			}),
		]);
	});

	it('skips providers without an API key so a half-configured backup never breaks the chain', () => {
		expect(resolveProviderChain({
			selection: ['openai', 'openrouter'],
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openai',
			}),
		]);
	});

	it('skips non-OpenAI providers without a model', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');

		expect(resolveProviderChain({
			selection: ['openai', 'openrouter'],
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openai',
			}),
		]);
	});

	it('honors provider base URL overrides and strips trailing slashes', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');
		vi.stubEnv('OPENROUTER_BASE_URL', 'https://proxy.example.test/v1/');

		expect(resolveProviderChain({
			selection: {
				openrouter: 'comparable-model',
			},
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openrouter',
				baseUrl: 'https://proxy.example.test/v1',
			}),
		]);
	});

	it('rejects unknown provider ids', () => {
		expect(() => resolveProviderChain({
			selection: ['acme' as never],
			openai,
		})).toThrow(AIConfigurationError);
	});

	it('throws when no provider in the selection is usable', () => {
		expect(() => resolveProviderChain({
			selection: null,
			openai: {
				...openai,
				apiKey: '',
			},
		})).toThrow(AIConfigurationError);
	});

	it('skips providers listed in AI_PROVIDER_DISABLED', () => {
		vi.stubEnv('AI_PROVIDER_DISABLED', 'openai');
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');
		vi.stubEnv('OPENROUTER_MODEL', 'router-default-model');

		expect(resolveProviderChain({
			selection: ['openai', 'openrouter'],
			openai,
		})).toEqual([
			expect.objectContaining({
				provider: 'openrouter',
			}),
		]);
	});

	it('throws a clear error when every selected provider is disabled', () => {
		vi.stubEnv('AI_PROVIDER_DISABLED', 'openai,openrouter');
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');
		vi.stubEnv('OPENROUTER_MODEL', 'router-default-model');

		expect(() => resolveProviderChain({
			selection: ['openai', 'openrouter'],
			openai,
		})).toThrow(/AI_PROVIDER_DISABLED/);
	});
});

describe('simulatedProviderOutage', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns null when AI_PROVIDER_OUTAGE is unset', () => {
		expect(simulatedProviderOutage('openai')).toBeNull();
	});

	it('returns a failoverable 503 for listed providers', () => {
		vi.stubEnv('AI_PROVIDER_OUTAGE', 'openai');

		expect(simulatedProviderOutage('openai')).toMatchObject({
			message: expect.stringContaining('AI_PROVIDER_OUTAGE'),
			code: 'service_unavailable',
			status: 503,
		});
		expect(simulatedProviderOutage('openrouter')).toBeNull();
	});
});

describe('providerChainFromEnvironment', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('returns null when AI_PROVIDER_CHAIN is unset or blank', () => {
		vi.stubEnv('AI_PROVIDER_CHAIN', '');

		expect(providerChainFromEnvironment()).toBeNull();
	});

	it('parses an ordered provider list', () => {
		vi.stubEnv('AI_PROVIDER_CHAIN', 'openai, openrouter');

		expect(providerChainFromEnvironment()).toEqual(['openai', 'openrouter']);
	});

	it('rejects unknown providers in the chain', () => {
		vi.stubEnv('AI_PROVIDER_CHAIN', 'openai,acme');

		expect(() => providerChainFromEnvironment()).toThrow(AIConfigurationError);
	});
});

describe('AI.resolveProviders', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('prefers explicit selections, then options, then the environment chain', () => {
		vi.stubEnv('OPENROUTER_API_KEY', 'router-key');
		vi.stubEnv('OPENROUTER_MODEL', 'router-default-model');
		vi.stubEnv('AI_PROVIDER_CHAIN', 'openrouter');

		const environmentDriven = new AI({
			apiKey: 'openai-key',
			model: 'gpt-test',
			rateLimiter: false,
		});

		expect(environmentDriven.resolveProviders().map(attempt => attempt.provider)).toEqual(['openrouter']);

		const optionDriven = new AI({
			apiKey: 'openai-key',
			model: 'gpt-test',
			provider: ['openai'],
			rateLimiter: false,
		});

		expect(optionDriven.resolveProviders().map(attempt => attempt.provider)).toEqual(['openai']);
		expect(optionDriven.resolveProviders(['openai', 'openrouter']).map(attempt => attempt.provider)).toEqual(['openai', 'openrouter']);
	});

	it('applies the per-call model to the OpenAI entry', () => {
		const ai = new AI({
			apiKey: 'openai-key',
			model: 'gpt-default',
			rateLimiter: false,
		});

		expect(ai.resolveProviders(null, 'gpt-call-override')).toEqual([
			expect.objectContaining({
				provider: 'openai',
				model: 'gpt-call-override',
			}),
		]);
	});
});
