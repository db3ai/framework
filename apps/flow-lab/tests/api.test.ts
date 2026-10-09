import type { GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { App } from '../server/app.js';
import { createServer } from '../server/index.js';
import { DEMO_CONTENT_PLAN_ID, DEMO_USER_ID } from '../server/demoData.js';
import { DemoArticle, DemoContentPlan } from '../server/models/index.js';

const SAMPLE_FLOW_ID = '01KXDNZE8JYH73Z55DA8QKCDM8';
const ARTICLE_FLOW_ID = '01KXDVYBKNBPTHGME52391YBVB';
const DAILY_FLOW_ID = '01KXDVYBKRNTT0XV0QKASZRQKX';

describe('Flow Lab API', () => {
	let database: GeneratedTestDatabase | undefined;
	let runtimeApp: App;
	let server: FastifyInstance | undefined;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('flow_lab_api');
		App.reset();
		runtimeApp = App.create({
			db: database.db,
			dbOptions: {
				reportSchemaDiff: false,
			},
			queue: {
				driver: 'database',
				queue: 'flows',
				retryDelaySeconds: 0,
				queueMonitor: false,
			},
		});
		server = await createServer(runtimeApp);
	});

	afterAll(async () => {
		await server?.close();
		App.reset();
		await database?.destroy();
	});

	it('executes and exposes every sample flow block boundary', async () => {
		const catalogResponse = await server.inject({
			method: 'GET',
			url: '/api/flows',
		});
		const catalog = catalogResponse.json();

		expect(catalogResponse.statusCode).toBe(200);
		expect(catalog.flows).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: SAMPLE_FLOW_ID,
				name: 'Greeting Debug Flow',
				inputs: expect.objectContaining({ name: expect.objectContaining({ type: 'string' }) }),
				outputs: expect.objectContaining({ greeting: expect.objectContaining({ type: 'string' }) }),
			}),
		]));
		expect(catalog.flows).toHaveLength(6);
		expect(catalog.blocks).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'database.fetch-article-inputs' }),
			expect.objectContaining({ type: 'database.insert-article' }),
			expect.objectContaining({ type: 'input.article-request' }),
			expect.objectContaining({ type: 'search.internal-link-candidates' }),
			expect.objectContaining({ type: 'search.external-link-candidates' }),
			expect.objectContaining({ type: 'article.plan-images' }),
			expect.objectContaining({ type: 'article.finalize' }),
			expect.objectContaining({ type: 'flow.input' }),
			expect.objectContaining({ type: 'flow.output' }),
			expect.objectContaining({ type: 'flow.subflow', kind: 'flow' }),
		]));

		const runResponse = await server.inject({
			method: 'POST',
			url: `/api/flows/${SAMPLE_FLOW_ID}/runs`,
			payload: {
				input: {
					name: 'Ada',
				},
			},
		});
		const created = runResponse.json();

		expect(runResponse.statusCode).toBe(202);
		expect(created.run.status).toBe('queued');

		let processed = 0;

		while (processed < 20 && await runtimeApp.queue.processNextJob('flows')) {
			processed += 1;
		}

		expect(processed).toBe(10);

		const detailsResponse = await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${created.run.id}`,
		});
		const details = detailsResponse.json();

		expect(detailsResponse.statusCode).toBe(200);
		expect(details.run.status).toBe('completed');
		expect(details.run.output).toEqual({
			greeting: 'HELLO, ADA!',
		});
		expect(details.steps).toHaveLength(4);
		expect(details.steps.every((step: { status: string }) => step.status === 'completed')).toBe(true);
		expect(details.events).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'nested.completed',
			}),
		]));

		const nestedStep = details.steps.find((step: { blockType: string }) => step.blockType === 'flow.subflow');
		const nestedDetailsResponse = await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${nestedStep.nestedRun}`,
		});
		const nestedDetails = nestedDetailsResponse.json();

		expect(nestedDetails.run.parentRun).toBe(created.run.id);
		expect(nestedDetails.steps).toHaveLength(6);
		expect(nestedDetails.events).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'step.log',
				level: 'info',
				message: 'Debug tap observed the greeting.',
				data: {
					greeting: 'Hello, Ada!',
				},
			}),
		]));
	});

	it('executes nested article generation and persists its reviewed output', async () => {
		const runResponse = await server.inject({
			method: 'POST',
			url: `/api/flows/${ARTICLE_FLOW_ID}/runs`,
			payload: {
				input: {
					request: {
						userId: DEMO_USER_ID,
						contentPlanId: DEMO_CONTENT_PLAN_ID,
					},
				},
			},
		});
		const created = runResponse.json();

		expect(runResponse.statusCode).toBe(202);
		await processFlowJobs(runtimeApp, 30);

		const detailsResponse = await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${created.run.id}`,
		});
		const details = detailsResponse.json();

		expect(details.run.status).toBe('completed');
		expect(details.steps).toHaveLength(8);
		expect(details.run.output.result.article).toEqual(expect.objectContaining({
			title: 'Observable AI Workflows: A Practical Guide',
			contentPlanId: DEMO_CONTENT_PLAN_ID,
			reviewStatus: 'approved',
			titleImage: 'https://images.example.test/article-flow-title.webp',
			bodyImages: expect.arrayContaining([
				'https://images.example.test/article-flow-body-1.webp',
				'https://images.example.test/article-flow-body-2.webp',
				'https://images.example.test/article-flow-body-3.webp',
			]),
			diagrams: ['https://images.example.test/article-flow-body-1.webp'],
			internalLinks: expect.arrayContaining([
				'https://analytical-engines.example.test/guides/background-jobs',
				'https://analytical-engines.example.test/guides/agent-observability',
				'https://analytical-engines.example.test/guides/workflow-replay',
			]),
			externalLinks: ['https://systems-lab.example.test/research/reliable-ai-operations'],
			metrics: {
				titleImages: 1,
				bodyImages: 3,
				diagrams: 1,
				internalLinks: 3,
				externalLinks: 1,
			},
		}));

		const nestedSteps = details.steps.filter((step: { nestedRun: string | null }) => step.nestedRun);

		expect(nestedSteps).toHaveLength(2);

		const researchDetails = (await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${nestedSteps[0].nestedRun}`,
		})).json();
		const writingDetails = (await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${nestedSteps[1].nestedRun}`,
		})).json();

		expect(researchDetails.steps).toHaveLength(7);
		expect(writingDetails.steps).toHaveLength(9);

		const articles = await DemoArticle.where('contentPlanId', DEMO_CONTENT_PLAN_ID).all();

		expect(articles).toHaveLength(1);
		expect(articles[0]?.images).toHaveLength(4);
		expect(articles[0]?.markdown).not.toContain('{{image:');
		expect(articles[0]?.markdown).toContain('[background job lifecycle](https://analytical-engines.example.test/guides/background-jobs)');
		expect(articles[0]?.markdown).toContain('[independent workflow reliability research](https://systems-lab.example.test/research/reliable-ai-operations)');
		expect((await DemoContentPlan.findOrFail(DEMO_CONTENT_PLAN_ID)).status).toBe('generated');
	});

	it('runs the daily planner through nested article generation', async () => {
		const runResponse = await server.inject({
			method: 'POST',
			url: `/api/flows/${DAILY_FLOW_ID}/runs`,
			payload: {
				input: {
					date: '2026-07-13',
				},
			},
		});
		const created = runResponse.json();

		expect(runResponse.statusCode).toBe(202);
		await processFlowJobs(runtimeApp, 40);

		const details = (await server.inject({
			method: 'GET',
			url: `/api/flow-runs/${created.run.id}`,
		})).json();

		expect(details.run.status).toBe('completed');
		expect(details.steps).toHaveLength(6);
		expect(details.run.output.result.article.reviewStatus).toBe('approved');
		expect((await DemoContentPlan.where('userId', DEMO_USER_ID).all())).toHaveLength(31);
		expect((await DemoContentPlan
			.where('userId', DEMO_USER_ID)
			.where('status', 'planned')
			.all())).toHaveLength(29);
	});
});

/**
 * Processes queued flow work until the queue becomes idle.
 *
 * @param runtimeApp - Flow Lab app owning the disposable test queue.
 * @param maximum - Safety limit for nested flow jobs.
 * @returns Number of jobs processed.
 */
async function processFlowJobs(runtimeApp: App, maximum: number): Promise<number> {
	let processed = 0;

	while (processed < maximum && await runtimeApp.queue.processNextJob('flows')) {
		processed += 1;
	}

	if (processed === maximum) {
		throw new Error(`Flow test exceeded its ${maximum}-job safety limit.`);
	}

	return processed;
}
