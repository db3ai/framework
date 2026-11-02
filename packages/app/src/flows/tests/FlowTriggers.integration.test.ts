import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Database } from '../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { FailedJob, QueuedJob } from '../../queue';
import { App } from '../../server';
import { FLOW_MODELS, FileFlowDefinitionStore, FlowDefinitionError, FlowRun, Flows, FlowStepJob, FlowTriggers } from '../index';
import { registerFlowTriggerRoutes } from '../triggers/fastify';
import { graphTestBlocks, leadIntakeFlow } from './flowGraphFixtures';

class TriggerTestApp extends App {
	flows!: Flows;
}

const env = { LEAD_TOKEN: 'secret-token-123', TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITE: 'site-key-1' };

describe('Flow triggers', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let app: TriggerTestApp | null = null;
	let root: string;
	let flows: Flows;
	let server: FastifyInstance;
	let turnstileAnswers: boolean[];
	let turnstileCalls: URLSearchParams[];

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('flows_triggers');
		db = database.db;
		app = new TriggerTestApp({
			db,
			queue: { queue: 'flows', retryDelaySeconds: 0, queueMonitor: false, jobResolver: async ({ jobName }) => jobName === FlowStepJob.jobName ? FlowStepJob : null },
		});
		await new Database(db, { reportSchemaDiff: false }).install(QueuedJob, FailedJob, ...FLOW_MODELS);
	});

	beforeEach(async () => {
		for (const table of ['flow_trigger_deliveries', 'flow_run_events', 'flow_step_runs', 'flow_runs', 'jobs']) await db(table).delete();
		root = await mkdtemp(join(tmpdir(), 'db3-flow-triggers-'));
		flows = new Flows({ queue: app!.queue, definitions: new FileFlowDefinitionStore({ root }), blocks: graphTestBlocks, queueName: 'flows', env: () => env });
		app!.flows = flows;
		const flow = leadIntakeFlow();
		flow.triggers = {
			website: { type: 'trigger.webhook', config: { token: { secret: 'LEAD_TOKEN' } } },
			contact: { type: 'trigger.form', config: { title: 'Contact us', thanks: 'Thanks, we will be in touch.' } },
			guarded: { type: 'trigger.form', config: { title: 'Guarded', turnstileSiteKey: '{{env.TURNSTILE_SITE}}', turnstileSecret: { secret: 'TURNSTILE_SECRET' } } },
			nightly: { type: 'trigger.schedule', config: { every: 'day', at: '07:00', input: { email: 'digest@example.com', message: 'Nightly check' } } },
		};
		await flows.saveDefinition(flow);

		turnstileAnswers = [];
		turnstileCalls = [];
		const triggers = new FlowTriggers(flows, {
			env: () => env,
			fetch: (async (_url: string, init: { body: URLSearchParams }) => {
				turnstileCalls.push(init.body);
				return { json: async () => ({ success: turnstileAnswers.shift() ?? false }) };
			}) as unknown as typeof fetch,
		});
		server = Fastify();
		await registerFlowTriggerRoutes(server, () => triggers);
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
		await app?.close();
		await database?.destroy();
	});

	it('starts a run from a webhook with the right token only', async () => {
		const payload = { email: 'ana@example.com', message: 'Hello' };
		expect((await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload })).statusCode).toBe(401);
		expect((await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload, headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
		expect((await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/contact', payload, headers: { authorization: 'Bearer secret-token-123' } })).statusCode).toBe(404);

		const accepted = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload, headers: { authorization: 'Bearer secret-token-123' } });
		expect(accepted.statusCode).toBe(202);
		const run = await FlowRun.findOrFail(accepted.json().runId);
		expect(run.input).toEqual(payload);

		const extra = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload: { ...payload, admin: true }, headers: { authorization: 'Bearer secret-token-123' } });
		expect(extra.statusCode).toBe(400);
		expect(extra.json().error).toMatch(/no input admin/);
	});

	it('returns the first run for a repeated Idempotency-Key and refuses it with other inputs', async () => {
		const headers = { authorization: 'Bearer secret-token-123', 'idempotency-key': 'delivery-1' };
		const first = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload: { email: 'a@example.com', message: 'Hi' }, headers });
		const again = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload: { message: 'Hi', email: 'a@example.com' }, headers });
		const other = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/website', payload: { email: 'b@example.com', message: 'Hi' }, headers });

		expect(first.json()).toMatchObject({ duplicate: false });
		expect(again.json()).toEqual({ runId: first.json().runId, status: 'accepted', duplicate: true });
		expect(other.statusCode).toBe(409);
		expect(await FlowRun.query().count()).toBe(1);
	});

	it('serves an embeddable form built from the flow inputs and starts a run when sent', async () => {
		const page = await server.inject({ method: 'GET', url: '/_db3/flows/lead-intake/contact/form' });
		expect(page.statusCode).toBe(200);
		expect(page.headers['content-security-policy']).toContain('frame-ancestors *');
		expect(page.body).toContain('<h1>Contact us</h1>');
		expect(page.body).toMatch(/<input id="f-email" type="email" name="email"/);
		expect(page.body).toMatch(/<textarea id="f-message" name="message"/);

		const missing = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/contact/form', payload: 'email=ana%40example.com', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
		expect(missing.statusCode).toBe(422);
		expect(missing.body).toContain('role="alert"');
		expect(missing.body).toContain('value="ana@example.com"');

		const sent = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/contact/form', payload: 'email=ana%40example.com&message=Hello+there', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
		expect(sent.statusCode).toBe(200);
		expect(sent.body).toContain('Thanks, we will be in touch.');
		const [run] = await FlowRun.query().all();
		expect(run.input).toEqual({ email: 'ana@example.com', message: 'Hello there' });

		const bot = await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/contact/form', payload: 'email=x%40example.com&message=spam&_website=http%3A%2F%2Fspam', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
		expect(bot.statusCode).toBe(200);
		expect(await FlowRun.query().count()).toBe(1);
	});

	it('checks Turnstile before starting a run from a guarded form', async () => {
		const page = await server.inject({ method: 'GET', url: '/_db3/flows/lead-intake/guarded/form' });
		expect(page.body).toContain('data-sitekey="site-key-1"');

		const body = 'email=ana%40example.com&message=Hi&cf-turnstile-response=token-1';
		const headers = { 'content-type': 'application/x-www-form-urlencoded' };
		turnstileAnswers.push(false);
		expect((await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/guarded/form', payload: body, headers })).statusCode).toBe(422);
		turnstileAnswers.push(true);
		expect((await server.inject({ method: 'POST', url: '/_db3/flows/lead-intake/guarded/form', payload: body, headers })).statusCode).toBe(200);

		expect(turnstileCalls.map(call => call.get('secret'))).toEqual(['ts-secret', 'ts-secret']);
		expect(await FlowRun.query().count()).toBe(1);
	});

	it('registers schedule triggers with the scheduler', async () => {
		const names = await flows.triggers.schedule(app!.scheduler);
		expect(names).toEqual(['lead-intake/nightly']);
		const definition = app!.scheduler.definitions().find(item => item.name === 'flows.lead-intake.nightly');
		expect(definition).toBeTruthy();
	});

	it('refuses a webhook without a token setting when the flow is checked', async () => {
		const flow = leadIntakeFlow();
		flow.triggers = { website: { type: 'trigger.webhook' }, nightly: { type: 'trigger.schedule', config: { every: 'week' } } };
		await expect(flows.saveDefinition(flow)).rejects.toThrow(FlowDefinitionError);
		await expect(flows.saveDefinition(flow)).rejects.toThrow(/token setting[\s\S]*every is minute, hour or day/);
	});
});
