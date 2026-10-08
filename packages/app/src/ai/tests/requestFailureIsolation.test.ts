import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { App } from '@db3.ai/app/server';
import { Ai, AiConversation, AiMessage, AiRequest, AiRateLimitBucket, AiRateLimitReservation, AIProviderStoppedError } from '@db3.ai/app/ai';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
let application: App;
const fetcher = vi.fn<typeof fetch>();
let ai: Ai;

beforeAll(async () => {
	database = await createGeneratedTestDatabase('request_failure_isolation');
	application = new App({ db: database.db, dbOptions: { reportSchemaDiff: false } });
	await application.db.install(AiConversation, AiRateLimitBucket, AiRequest, AiMessage, AiRateLimitReservation);
});
beforeEach(async () => {
	await AiRateLimitReservation.query().delete();
	await AiRequest.query().delete();
	await AiRateLimitBucket.query().delete();
	fetcher.mockReset();
	ai = new Ai({ apiKey: 'synthetic-isolation', baseUrl: 'https://synthetic.invalid/v1', model: 'test', fetch: fetcher, rateLimiter: false });
});
afterAll(async () => { try { await application?.close(); } finally { await database?.destroy(); } });

/** Executes optional structured work through the actual tracked provider boundary. */
function optionalRequest() {
	return ai.generateStructured({ instructions: 'Extract.', input: 'Evidence.', schemaName: 'optional-test', schema: z.object({ answer: z.string() }), transientFailureScope: 'request' });
}

describe('optional structured request failure isolation', () => {
	it.each(['timeout', 'server', 'invalid-output'])('keeps %s failures local and admits a later normal request', async kind => {
		fetcher.mockImplementationOnce(async () => {
			if (kind === 'timeout') throw new DOMException('Request expired.', 'TimeoutError');
			if (kind === 'server') return Response.json({ error: { code: 'server_error' } }, { status: 503 });
			return Response.json({ output_text: '{"wrong":true}', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
		});
		await expect(optionalRequest()).rejects.toThrow();
		fetcher.mockResolvedValueOnce(Response.json({ output_text: 'Available', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
		await expect(ai.generateText({ instructions: '', input: 'Other work' })).resolves.toBe('Available');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('preserves shared exhausted-credit protection', async () => {
		fetcher.mockResolvedValue(Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }));
		await expect(optionalRequest()).rejects.toBeInstanceOf(AIProviderStoppedError);
		await expect(ai.generateText({ instructions: '', input: 'Other work' })).rejects.toBeInstanceOf(AIProviderStoppedError);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('honours an existing account outage rather than bypassing admission', async () => {
		fetcher.mockResolvedValue(Response.json({ error: { code: 'server_error' } }, { status: 503 }));
		await expect(ai.generateText({ instructions: '', input: 'Ordinary work' })).rejects.toThrow();
		await expect(optionalRequest()).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
