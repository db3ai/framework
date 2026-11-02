import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Database } from '../../db';
import { ulid } from '@db3.ai/pure/ulid';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { FailedJob, QueuedJob } from '../../queue';
import { App } from '../../server';
import { FLOW_MODELS, FLOW_REPLAY_DEFINITION, FLOW_RUN_EVENT_TYPE, FLOW_RUN_STATUS, FLOW_STEP_STATUS, FileFlowDefinitionStore, FlowDefinitionError, FlowRun, FlowRunEvent, Flows, FlowStepJob, FlowStepRun, type FlowGraphDefinition } from '../index';
import { graphTestBlocks, leadIntakeFlow } from './flowGraphFixtures';
import { ConsoleFlowRuns, knexExecutor } from '../../console';

/** Test app exposing the flow service through the active-app seam. */
class FlowGraphTestApp extends App {
	flows!: Flows;
}

describe('Flows file shape 2', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let app: FlowGraphTestApp | null = null;
	let root: string;
	let flows: Flows;
	let flow: FlowGraphDefinition;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('flows_graph');
		db = database.db;
		app = new FlowGraphTestApp({
			db,
			queue: {
				queue: 'flows',
				retryDelaySeconds: 0,
				queueMonitor: false,
				jobResolver: async ({ jobName }) => jobName === FlowStepJob.jobName ? FlowStepJob : null,
			},
		});
		await new Database(db, { reportSchemaDiff: false }).install(QueuedJob, FailedJob, ...FLOW_MODELS);
	});

	beforeEach(async () => {
		await db('flow_run_events').delete();
		await db('flow_step_runs').delete();
		await db('flow_runs').delete();
		await db('jobs_failed').delete();
		await db('jobs').delete();

		root = await mkdtemp(join(tmpdir(), 'db3-flows-v2-'));
		flows = new Flows({
			queue: app!.queue,
			definitions: new FileFlowDefinitionStore({ root }),
			blocks: graphTestBlocks,
			queueName: 'flows',
			maxTries: 2,
		});
		app!.flows = flows;
		flow = leadIntakeFlow();
		await flows.saveDefinition(flow);
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
		await app?.close();
		await database?.destroy();
	});

	it('writes a readable file and lists it by name', async () => {
		const file = await readFile(join(root, 'lead-intake.flow.json'), 'utf8');
		const parsed = JSON.parse(file);

		expect(Object.keys(parsed)).toEqual(['schemaVersion', 'id', 'name', 'title', 'inputs', 'outputs', 'triggers', 'steps', 'edges', 'layout']);
		expect(Object.keys(parsed.steps)).toEqual(['classify', 'block', 'crm', 'reply', 'page', 'alert']);

		const [summary] = await flows.definitions.list();
		expect(summary).toMatchObject({ id: flow.id, name: 'lead-intake', title: 'Lead intake', schemaVersion: 2 });
		expect(summary.outputs.kind).toEqual({ type: 'string', required: true });
		expect((await flows.definition('lead-intake')).definition).toEqual(flow);
	});

	it('refuses to save a flow that does not check', async () => {
		const broken = leadIntakeFlow();
		broken.steps.block.config = { label: '{{crm.saved}}' };

		await expect(flows.saveDefinition(broken)).rejects.toBeInstanceOf(FlowDefinitionError);
	});

	it('runs the lead branch side by side, skips spam, and routes a failure to its error exit', async () => {
		const created = await flows.start('lead-intake', { email: 'ana@example.com', message: 'We need a new website.' });
		expect(created.status).toBe(FLOW_RUN_STATUS.queued);

		await workUntilIdle(app!);

		const run = await FlowRun.findOrFail(created.id!);
		expect(run.status).toBe(FLOW_RUN_STATUS.completed);
		expect(run.output).toEqual({ kind: 'lead', reply: 'reply to ana@example.com' });

		const steps = Object.fromEntries((await FlowStepRun.where('run', run).orderBy('sequence').all()).map(step => [step.blockId, step]));
		expect(steps.classify).toMatchObject({ status: FLOW_STEP_STATUS.completed, exit: 'lead', output: { kind: 'lead', score: 87 } });
		expect(steps.block.status).toBe(FLOW_STEP_STATUS.skipped);
		expect(steps.crm).toMatchObject({ status: FLOW_STEP_STATUS.completed, input: { label: 'crm ana@example.com scored 87' } });
		expect(steps.reply.status).toBe(FLOW_STEP_STATUS.completed);
		expect(steps.page).toMatchObject({ status: FLOW_STEP_STATUS.failed, exit: 'error', attempt: 2 });
		expect(steps.alert).toMatchObject({ status: FLOW_STEP_STATUS.completed, output: { saved: 'paging failed: Chat service is down.' } });

		const events = await FlowRunEvent.where('run', run).orderBy('sequence').all();
		expect(events.map(event => event.sequence)).toEqual(events.map((_event, index) => index));
		expect(events.filter(event => event.type === FLOW_RUN_EVENT_TYPE.stepSkipped)).toHaveLength(1);
		expect(events.filter(event => event.type === FLOW_RUN_EVENT_TYPE.stepQueued).map(event => event.message)).toContain('Page team queued.');
		expect(events.at(-1)!.type).toBe(FLOW_RUN_EVENT_TYPE.runCompleted);
	});

	it('reads runs back with plain SQL, as Cloud does through a tunnel', async () => {
		const created = await flows.start('lead-intake', { email: 'ana@example.com', message: 'We need a new website.' });
		await flows.start('lead-intake', { email: 'bot@example.com', message: 'Win at the casino' });
		await workUntilIdle(app!);
		// The tunnel answers with rows as arrays, and bindings written in.
		const runner = knexExecutor(db);
		const reader = new ConsoleFlowRuns({ client: 'mysql2', run: async (sql, bindings) => ({ rows: (await runner.run(sql, bindings)).rows.map(row => Object.values(row)), affectedRows: 0 }) });

		const page = await reader.runs(flow.id, { search: 'ana@', perPage: 5 });
		expect(page.total).toBe(1);
		expect(page.runs[0]).toMatchObject({ id: created.id, status: 'completed', input: { email: 'ana@example.com' }, parentRun: null });
		expect((await reader.runs(flow.id, { status: 'failed' })).total).toBe(0);

		const details = await reader.details(created.id!);
		expect(details!.run.definitionSnapshot).toMatchObject({ name: 'lead-intake' });
		expect(details!.steps.find(step => step.blockId === 'classify')).toMatchObject({ exit: 'lead', output: { kind: 'lead', score: 87 }, run: created.id });
		expect(details!.events.at(-1)!.type).toBe(FLOW_RUN_EVENT_TYPE.runCompleted);
		expect(await reader.details('missing')).toBeNull();
	});

	it('takes the spam branch and skips everything on the lead side', async () => {
		const created = await flows.start('lead-intake', { email: 'bot@example.com', message: 'Win at the casino' });
		await workUntilIdle(app!);

		const run = await FlowRun.findOrFail(created.id!);
		const status = Object.fromEntries((await FlowStepRun.where('run', run).all()).map(step => [step.blockId, step.status]));

		expect(run.status).toBe(FLOW_RUN_STATUS.completed);
		expect(run.output).toEqual({ kind: 'spam', reply: null });
		expect(status).toEqual({
			classify: FLOW_STEP_STATUS.completed,
			block: FLOW_STEP_STATUS.completed,
			crm: FLOW_STEP_STATUS.skipped,
			reply: FLOW_STEP_STATUS.skipped,
			page: FLOW_STEP_STATUS.skipped,
			alert: FLOW_STEP_STATUS.skipped,
		});
	});

	it('fails the run when a step fails with no error exit', async () => {
		flow.edges = flow.edges.filter(([from]) => from !== 'page.error');
		delete flow.steps.alert;
		await flows.saveDefinition(flow);

		const created = await flows.start(flow.id, { email: 'ana@example.com', message: 'Hello' });
		await workUntilIdle(app!);

		const run = await FlowRun.findOrFail(created.id!);
		expect(run.status).toBe(FLOW_RUN_STATUS.failed);
		expect(run.error?.message).toBe('Chat service is down.');
	});

	it('pages, filters and searches runs', async () => {
		for (const email of ['ana@example.com', 'bo@example.com', 'cy@example.com']) {
			await flows.start('lead-intake', { email, message: email === 'bo@example.com' ? 'casino' : 'Hello' });
		}
		await workUntilIdle(app!);

		const first = await flows.findRuns(flow.id, { page: 1, perPage: 2 });
		const second = await flows.findRuns(flow.id, { page: 2, perPage: 2 });
		expect(first.total).toBe(3);
		expect(first.runs).toHaveLength(2);
		expect(second.runs).toHaveLength(1);
		expect(new Set([...first.runs, ...second.runs].map(run => run.id)).size).toBe(3);

		const found = await flows.findRuns(flow.id, { search: 'bo@ex' });
		expect(found.runs.map(run => run.input?.email)).toEqual(['bo@example.com']);
		expect((await flows.findRuns(flow.id, { status: 'failed' })).total).toBe(0);
	});

	it('runs another flow and waits for its outputs, or starts one without waiting', async () => {
		const child: FlowGraphDefinition = {
			schemaVersion: 2, id: ulid(), name: 'crm-sync',
			inputs: { email: { type: 'string', required: true } },
			outputs: { crmId: { type: 'string', value: '{{save.saved}}' } },
			steps: { save: { type: 'test.record', config: { label: 'crm-{{input.email}}' } } },
			edges: [['input', 'save']],
		};
		const failing: FlowGraphDefinition = { ...child, id: ulid(), name: 'always-fails', outputs: {}, steps: { boom: { type: 'test.fail' } }, edges: [['input', 'boom']] };
		await flows.saveDefinition(child);
		await flows.saveDefinition(failing);
		const parent: FlowGraphDefinition = {
			schemaVersion: 2, id: ulid(), name: 'parent',
			inputs: { email: { type: 'string', required: true } },
			outputs: { crmId: { type: 'string', value: '{{sync.crmId}}' }, note: { type: 'string', value: '{{after-fail.saved}}' } },
			steps: {
				sync: { type: 'flow.run', flow: 'crm-sync', config: { email: '{{input.email}}' } },
				later: { type: 'flow.start', flow: 'crm-sync', config: { email: 'later@example.com' } },
				risky: { type: 'flow.run', flow: 'always-fails', config: { email: '{{input.email}}' } },
				'after-fail': { type: 'test.record', config: { label: 'child failed: {{risky.error.message}}' } },
			},
			edges: [['input', 'sync'], ['input', 'later'], ['sync', 'risky'], ['risky.error', 'after-fail']],
		};
		await flows.saveDefinition(parent);

		const created = await flows.start('parent', { email: 'ana@example.com' });
		await workUntilIdle(app!);

		const run = await FlowRun.findOrFail(created.id!);
		expect(run.status).toBe(FLOW_RUN_STATUS.completed);
		expect(run.output).toEqual({ crmId: 'crm-ana@example.com', note: 'child failed: Chat service is down.' });
		const steps = Object.fromEntries((await FlowStepRun.where('run', run).all()).map(step => [step.blockId, step]));
		expect(steps.sync.status).toBe(FLOW_STEP_STATUS.completed);
		expect(steps.risky).toMatchObject({ status: FLOW_STEP_STATUS.failed, exit: 'error' });
		const started = await FlowRun.findOrFail(String(steps.later.output?.runId));
		expect(started).toMatchObject({ status: FLOW_RUN_STATUS.completed, output: { crmId: 'crm-later@example.com' } });
		expect(started.parentRun).toBeNull();
	});

	it('refuses flow steps that name a missing flow, wrong inputs, or wait on themselves', async () => {
		const parent: FlowGraphDefinition = {
			schemaVersion: 2, id: ulid(), name: 'bad-parent', inputs: {},
			steps: {
				missing: { type: 'flow.run', flow: 'no-such-flow' },
				wrong: { type: 'flow.run', flow: 'lead-intake', config: { colour: 'blue' } },
				self: { type: 'flow.run', flow: 'bad-parent' },
			},
			edges: [['input', 'missing'], ['input', 'wrong'], ['input', 'self']],
		};
		const error = await flows.saveDefinition(parent).catch(caught => caught);
		expect(error).toBeInstanceOf(FlowDefinitionError);
		expect(error.message).toMatch(/no flow "no-such-flow"/);
		expect(error.message).toMatch(/lead-intake has no input "colour"/);
		expect(error.message).toMatch(/lead-intake needs "email"/);
		expect(error.message).toMatch(/cannot wait on itself/);
	});

	it('replays a run with its original file', async () => {
		const first = await flows.start('lead-intake', { email: 'ana@example.com', message: 'Hello' });
		await workUntilIdle(app!);

		flow.steps.reply.config = { label: 'thanks {{input.email}}' };
		await flows.saveDefinition(flow);

		const original = await flows.replay(first.id!, { definition: FLOW_REPLAY_DEFINITION.original });
		const latest = await flows.replay(first.id!, { definition: FLOW_REPLAY_DEFINITION.latest });
		await workUntilIdle(app!);

		expect((await FlowRun.findOrFail(original.id!)).output).toMatchObject({ reply: 'reply to ana@example.com' });
		expect((await FlowRun.findOrFail(latest.id!)).output).toMatchObject({ reply: 'thanks ana@example.com' });
	});
});

/**
 * Processes queued jobs until none are left.
 *
 * @param app - Test application owning the queue.
 */
async function workUntilIdle(app: App): Promise<void> {
	while (await app.queue.processNextJob('flows')) {
		// Keep going until the run has nothing queued.
	}
}
