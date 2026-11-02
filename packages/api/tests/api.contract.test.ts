import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { API_MANIFEST_PATH, agentsApi, parseApiConfig, registerApi, type AgentRunInput, type AgentRuns, type ApiCaller, type ApiConfig, type ApiManifest } from '../src';

/**
 * Contract for the public API an environment serves. The handlers are fakes: these tests pin the
 * HTTP boundary (switches, keys, origins, access, input, answers) that Cloud and frontends rely on.
 */

const SECRET = 'db3_sk_test_secret_0001';
const SECRET_NEXT = 'db3_sk_test_secret_0002';
const PUBLISHABLE = 'db3_pk_test_public_0001';
const SITE = 'https://support.example.com';
const RUNS = '/_db3/api/v1/agents/triage/runs';

class FakeRuns implements AgentRuns {
	started: Array<{ agent: string; input: AgentRunInput; caller: ApiCaller; idempotencyKey?: string }> = [];
	async names() { return ['triage', 'billing']; }
	async start(agent: string, input: AgentRunInput, caller: ApiCaller, idempotencyKey?: string) {
		if (!['triage', 'billing'].includes(agent)) return null;
		this.started.push({ agent, input, caller, idempotencyKey });
		return { runId: `run_${this.started.length}`, conversationId: input.conversationId ?? 'conv_1', duplicate: false };
	}
	async get(_agent: string, runId: string, caller: ApiCaller) {
		const run = this.started.find((_, index) => `run_${index + 1}` === runId);
		if (!run) return null;
		if (caller.kind === 'user' && (run.caller.kind !== 'user' || run.caller.userId !== caller.userId)) return null;
		return { runId, conversationId: 'conv_1', status: 'running' as const, output: null, error: null };
	}
}

describe('Public API contract', () => {
	let server: FastifyInstance;
	let config: ApiConfig;
	let runs: FakeRuns;

	const open = (services: ApiConfig['services'], extra: Partial<ApiConfig> = {}) => {
		config = parseApiConfig({ enabled: true, origins: [SITE], services, ...extra });
	};
	const call = (method: 'GET' | 'POST' | 'OPTIONS', url: string, options: { key?: string; origin?: string; user?: string; body?: unknown; headers?: Record<string, string> } = {}) => server.inject({
		method,
		url,
		payload: options.body as never,
		headers: {
			...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
			...(options.origin ? { origin: options.origin } : {}),
			...(options.user ? { cookie: `session=${options.user}` } : {}),
			...options.headers,
		},
	});

	beforeEach(async () => {
		runs = new FakeRuns();
		config = parseApiConfig(undefined);
		server = Fastify();
		await registerApi(server, {
			config: () => config,
			keys: () => ({ secret: [SECRET, SECRET_NEXT], publishable: [PUBLISHABLE] }),
			services: [agentsApi(runs)],
			users: async headers => /session=(\w+)/.exec(String(headers.cookie ?? ''))?.[1] ?? null,
		});
	});

	describe('off by default', () => {
		it('answers 404 for every route while the API is disabled, even with a secret key', async () => {
			const response = await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' } });
			expect(response.statusCode).toBe(404);
			expect(response.json()).toMatchObject({ code: 'not_found' });
			expect(runs.started).toHaveLength(0);
		});

		it('answers 404 for a route that is not listed, as if it did not exist', async () => {
			open({ agents: { 'billing.run': 'secret' } });
			expect((await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' } })).statusCode).toBe(404);
		});
	});

	describe('keys', () => {
		it('needs a key', async () => {
			open({ agents: { 'triage.run': 'secret' } });
			const response = await call('POST', RUNS, { body: { input: 'Hi' } });
			expect(response.statusCode).toBe(401);
			expect(response.json()).toMatchObject({ code: 'unauthorized' });
		});

		it('refuses unknown keys', async () => {
			open({ agents: { 'triage.run': 'secret' } });
			expect((await call('POST', RUNS, { key: 'db3_sk_wrong', body: { input: 'Hi' } })).statusCode).toBe(401);
		});

		it('accepts every listed secret key, so a key can be rotated without downtime', async () => {
			open({ agents: { 'triage.run': 'secret' } });
			expect((await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' } })).statusCode).toBe(202);
			expect((await call('POST', RUNS, { key: SECRET_NEXT, body: { input: 'Hi' } })).statusCode).toBe(202);
		});

		it('refuses the publishable key on a secret route', async () => {
			open({ agents: { 'triage.run': 'secret' } });
			const response = await call('POST', RUNS, { key: PUBLISHABLE, body: { input: 'Hi' } });
			expect(response.statusCode).toBe(403);
			expect(response.json()).toMatchObject({ code: 'forbidden' });
		});

		it('refuses a secret key sent from a browser', async () => {
			open({ agents: { 'triage.run': 'publishable' } });
			expect((await call('POST', RUNS, { key: SECRET, origin: SITE, body: { input: 'Hi' } })).statusCode).toBe(403);
		});

		it('lets a secret key call any open route', async () => {
			open({ agents: { 'triage.run': 'user' } });
			expect((await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' } })).statusCode).toBe(202);
			expect(runs.started.at(-1)?.caller).toMatchObject({ kind: 'secret' });
		});
	});

	describe('browsers', () => {
		it('accepts the publishable key from an allowed origin and says so to the browser', async () => {
			open({ agents: { 'triage.run': 'publishable' } });
			const response = await call('POST', RUNS, { key: PUBLISHABLE, origin: SITE, body: { input: 'Hi' } });
			expect(response.statusCode).toBe(202);
			expect(response.headers['access-control-allow-origin']).toBe(SITE);
		});

		it('refuses other origins', async () => {
			open({ agents: { 'triage.run': 'publishable' } });
			expect((await call('POST', RUNS, { key: PUBLISHABLE, origin: 'https://evil.example', body: { input: 'Hi' } })).statusCode).toBe(403);
		});

		it('answers preflight for allowed origins only', async () => {
			open({ agents: { 'triage.run': 'publishable' } });
			const allowed = await call('OPTIONS', RUNS, { origin: SITE, headers: { 'access-control-request-method': 'POST' } });
			expect(allowed.statusCode).toBe(204);
			expect(allowed.headers['access-control-allow-origin']).toBe(SITE);
			const refused = await call('OPTIONS', RUNS, { origin: 'https://evil.example', headers: { 'access-control-request-method': 'POST' } });
			expect(refused.headers['access-control-allow-origin']).toBeUndefined();
		});
	});

	describe('end users', () => {
		it('needs a signed-in user on a user route', async () => {
			open({ agents: { 'triage.run': 'user' } });
			expect((await call('POST', RUNS, { key: PUBLISHABLE, origin: SITE, body: { input: 'Hi' } })).statusCode).toBe(401);
		});

		it('passes the user to the service, which decides what they may see', async () => {
			open({ agents: { 'triage.run': 'user' } });
			const started = await call('POST', RUNS, { key: PUBLISHABLE, origin: SITE, user: 'ana', body: { input: 'Hi' } });
			expect(started.statusCode).toBe(202);
			expect(runs.started.at(-1)?.caller).toMatchObject({ kind: 'user', userId: 'ana' });

			const { runId } = started.json();
			expect((await call('GET', `${RUNS}/${runId}`, { key: PUBLISHABLE, origin: SITE, user: 'ana' })).statusCode).toBe(200);
			expect((await call('GET', `${RUNS}/${runId}`, { key: PUBLISHABLE, origin: SITE, user: 'bob' })).statusCode).toBe(404);
		});
	});

	describe('agent runs', () => {
		beforeEach(() => open({ agents: { 'triage.run': 'secret' } }));

		it('queues a run and answers 202 with where to follow it', async () => {
			const response = await call('POST', RUNS, { key: SECRET, body: { input: 'My invoice is wrong', context: { plan: 'pro' } } });
			expect(response.statusCode).toBe(202);
			expect(response.json()).toEqual({
				runId: 'run_1',
				conversationId: 'conv_1',
				status: 'queued',
				duplicate: false,
				links: { self: `${RUNS}/run_1`, events: `${RUNS}/run_1/events` },
			});
			expect(runs.started[0]).toMatchObject({ agent: 'triage', input: { input: 'My invoice is wrong', context: { plan: 'pro' } } });
		});

		it('passes the Idempotency-Key through so retries return the first run', async () => {
			await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' }, headers: { 'idempotency-key': 'order-42' } });
			expect(runs.started[0].idempotencyKey).toBe('order-42');
		});

		it('refuses a body that does not match the contract', async () => {
			for (const body of [{}, { input: '' }, { input: 'Hi', extra: true }, { input: 42 }]) {
				const response = await call('POST', RUNS, { key: SECRET, body });
				expect(response.statusCode).toBe(400);
				expect(response.json()).toMatchObject({ code: 'invalid_input' });
			}
			expect(runs.started).toHaveLength(0);
		});

		it('reads a run with the access of the run route', async () => {
			const { runId } = (await call('POST', RUNS, { key: SECRET, body: { input: 'Hi' } })).json();
			const response = await call('GET', `${RUNS}/${runId}`, { key: SECRET });
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ runId, conversationId: 'conv_1', status: 'running', output: null, error: null });
			expect((await call('GET', `${RUNS}/run_999`, { key: SECRET })).statusCode).toBe(404);
		});
	});

	describe('manifest for Cloud', () => {
		it('needs a secret key', async () => {
			expect((await call('GET', API_MANIFEST_PATH)).statusCode).toBe(401);
			expect((await call('GET', API_MANIFEST_PATH, { key: PUBLISHABLE })).statusCode).toBe(403);
		});

		it('lists every route this build can expose, with its current access, even while disabled', async () => {
			const manifest = (await call('GET', API_MANIFEST_PATH, { key: SECRET })).json() as ApiManifest;
			expect(manifest).toMatchObject({ version: 1, prefix: '/_db3/api/v1', enabled: false });
			const agents = manifest.services.find(service => service.name === 'agents');
			expect(agents?.resources.map(resource => resource.name)).toEqual(['triage', 'billing']);
			expect(agents?.resources[0].routes.map(route => [route.method, route.path, route.access])).toEqual([
				['POST', '/_db3/api/v1/agents/triage/runs', 'off'],
				['GET', '/_db3/api/v1/agents/triage/runs/:run', 'off'],
			]);
		});

		it('shows what db3/api.json opened, with JSON Schemas for the docs', async () => {
			open({ agents: { 'triage.run': 'user' } });
			const manifest = (await call('GET', API_MANIFEST_PATH, { key: SECRET })).json() as ApiManifest;
			const triage = manifest.services[0].resources.find(resource => resource.name === 'triage')!;
			expect(triage.routes.map(route => route.access)).toEqual(['user', 'user']);
			expect(triage.routes[0].input).toMatchObject({ type: 'object', required: ['input'] });
			expect(manifest.origins).toEqual([SITE]);
		});
	});
});
