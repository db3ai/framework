import { describe, expect, it, vi } from 'vitest';
import { AIProviderTransport, AIProviderRetryError, AIProviderStoppedError, type AIProviderAttempt } from '@db3.ai/app/ai';

const attempt: AIProviderAttempt = { provider: 'openai', apiKey: 'synthetic', baseUrl: 'https://provider.invalid', model: 'test', supportsResponsesApi: true };

describe('request-local provider transport', () => {
	it.each([503, 408, 429])('never blocks a subsequent request after HTTP %i', async status => {
		const transport = new AIProviderTransport();
		const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { code: status === 429 ? 'insufficient_quota' : 'server_error' } }, { status })).mockResolvedValueOnce(Response.json({ output_text: 'Available' }));
		await transport.transport(attempt, fetcher)('https://provider.invalid');
		expect(transport.requestFailure(attempt, null)).toBeInstanceOf(status === 429 ? AIProviderStoppedError : AIProviderRetryError);
		await expect(transport.transport(attempt, fetcher)('https://provider.invalid')).resolves.toHaveProperty('status', 200);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(transport.requestFailure(attempt, null)).toBeNull();
	});

	it('retains safe diagnostics and bounded provider retry timing without retaining raw error text', async () => {
		const transport = new AIProviderTransport();
		await transport.transport(attempt, async () => Response.json({ error: { code: 'server_error', message: 'PRIVATE customer text' } }, { status: 503, headers: { 'retry-after-ms': '1', 'x-request-id': 'req_test' } }))('https://provider.invalid');
		expect(transport.requestRetryDelay(attempt, new Error('SDK wrapper'))).toBe(1);
		const error = transport.requestFailure(attempt, null);
		expect(error).toMatchObject({ providerCode: 'server_error', diagnostics: { status: 503, requestId: 'req_test' } });
		expect(JSON.stringify(error)).not.toContain('PRIVATE');
	});

	it('preserves cancellation and terminal errors ahead of cached transient diagnostics', async () => {
		const transport = new AIProviderTransport();
		const fetcher = async () => Response.json({ error: { code: 'server_error' } }, { status: 503 });
		for (const error of [new DOMException('Stopped', 'AbortError'), new AIProviderStoppedError('quota')]) {
			await transport.transport(attempt, fetcher)('https://provider.invalid');
			expect(transport.requestFailure(attempt, error)).toBe(error);
		}
	});

	it('isolates concurrent requests using the same credential', async () => {
		const transport = new AIProviderTransport();
		const sibling = { ...attempt };
		await transport.transport(attempt, async () => Response.json({ error: { code: 'server_error' } }, { status: 503 }))('https://provider.invalid');
		const response = await transport.transport(sibling, async () => Response.json({ output_text: 'Success' }))('https://provider.invalid');
		expect(await response.json()).toMatchObject({ output_text: 'Success' });
		expect(transport.requestFailure(sibling, null)).toBeNull();
		expect(transport.requestFailure(attempt, null)).toBeInstanceOf(AIProviderRetryError);
	});
});
