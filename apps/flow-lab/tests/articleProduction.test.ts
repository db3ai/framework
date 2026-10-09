import type { FlowBlockContext, FlowBlockDefinition, FlowValue, FlowValues } from '@db3.ai/app/flows';
import { describe, expect, it } from 'vitest';

import FinalizeArticle from '../server/flow-blocks/FinalizeArticle.js';
import GenerateImages from '../server/flow-blocks/GenerateImages.js';
import PlaceImages from '../server/flow-blocks/PlaceImages.js';
import PlanArticleImages from '../server/flow-blocks/PlanArticleImages.js';
import RequestInput from '../server/flow-blocks/RequestInput.js';
import SelectArticleLinks from '../server/flow-blocks/SelectArticleLinks.js';
import WeaveArticleLinks from '../server/flow-blocks/WeaveArticleLinks.js';
import WriteArticle from '../server/flow-blocks/WriteArticle.js';

const ARTICLE_PLAN: FlowValues = {
	title: 'Observable AI Workflows: A Practical Guide',
	sections: [
		'Why background AI work becomes opaque',
		'Define durable workflow boundaries',
		'Observe every model and tool transition',
		'Replay without losing historical truth',
		'Put the workflow into production',
	],
};

const LINK_CANDIDATES: FlowValues = {
	internalLinkCandidates: [
		candidate('internal', 'background job lifecycle', 'https://site.example.test/background-jobs', 95),
		candidate('internal', 'agent observability', 'https://site.example.test/agent-observability', 92),
		candidate('internal', 'workflow replay', 'https://site.example.test/workflow-replay', 89),
		candidate('internal', 'queue driver selection', 'https://site.example.test/queue-drivers', 82),
	],
	externalLinkCandidates: [
		candidate('external', 'independent workflow reliability research', 'https://partner.example.test/reliability', 94),
		candidate('external', 'AI observability benchmarks', 'https://partner.example.test/benchmarks', 86),
	],
};

const context: FlowBlockContext = {
	flowId: '01KY01DHDZYTE59RD2MVWYBW7G',
	runId: '01KY01DHDZDHKGEZ4VXHE22H6E',
	stepRunId: '01KY01DHDZ94836GY7WKWA2RD4',
	block: {
		id: '01KY01DHDZB3XKYWW75RNXSFR1',
		type: 'test.article-production',
		position: { x: 0, y: 0 },
	},
	config: {},
	/**
	 * Discards durable block logs in focused function tests.
	 *
	 * @returns Resolved promise after accepting the log entry.
	 */
	async log() {},
};

describe('Flow Lab article production blocks', () => {
	it('normalizes the included image policy and rejects unentitled extras', async () => {
		const defaultOutput = await runBlock(RequestInput, {
			request: {
				userId: '01KXDVYBKJFHDBTEH2J8MQC25D',
				contentPlanId: '01KXDVYBKM23VQ2DTETC09YM4R',
			},
		});
		const state = requiredObject(defaultOutput.state, 'output.state');
		const request = requiredObject(state.request, 'output.state.request');

		expect(request.imagePolicy).toEqual({
			bodyImageCount: 3,
			paidExtraImageAllowance: 0,
			requireDiagram: true,
		});

		await expect(runBlock(RequestInput, {
			request: {
				userId: '01KXDVYBKJFHDBTEH2J8MQC25D',
				contentPlanId: '01KXDVYBKM23VQ2DTETC09YM4R',
				imagePolicy: {
					bodyImageCount: 5,
					paidExtraImageAllowance: 0,
					requireDiagram: true,
				},
			},
		})).rejects.toThrow(/exceeds the included and paid allowance of 4/);

		await expect(runBlock(RequestInput, {
			request: {
				userId: '01KXDVYBKJFHDBTEH2J8MQC25D',
				contentPlanId: '01KXDVYBKM23VQ2DTETC09YM4R',
				imagePolicy: {
					bodyImageCount: 1,
					paidExtraImageAllowance: 0,
					requireDiagram: false,
				},
			},
		})).rejects.toThrow(/must be at least 2/);
	});

	it('plans the title image plus paid body images with one required diagram', async () => {
		const state = await runStateBlock(PlanArticleImages, {
			request: {
				imagePolicy: {
					bodyImageCount: 6,
					paidExtraImageAllowance: 2,
					requireDiagram: true,
				},
			},
			articlePlan: ARTICLE_PLAN,
		});
		const imagePlan = requiredObject(state.imagePlan, 'state.imagePlan');
		const assets = requiredObjectArray(imagePlan.assets, 'state.imagePlan.assets');

		expect(assets).toHaveLength(7);
		expect(assets.filter(asset => asset.role === 'title')).toHaveLength(1);
		expect(assets.filter(asset => asset.role === 'body')).toHaveLength(6);
		expect(assets.filter(asset => asset.kind === 'diagram')).toHaveLength(1);
	});

	it('keeps the diagram optional when the request disables it', async () => {
		const state = await runStateBlock(PlanArticleImages, {
			request: {
				imagePolicy: {
					bodyImageCount: 2,
					paidExtraImageAllowance: 0,
					requireDiagram: false,
				},
			},
			articlePlan: ARTICLE_PLAN,
		});
		const imagePlan = requiredObject(state.imagePlan, 'state.imagePlan');
		const assets = requiredObjectArray(imagePlan.assets, 'state.imagePlan.assets');

		expect(assets).toHaveLength(3);
		expect(assets.filter(asset => asset.role === 'body')).toHaveLength(2);
		expect(assets.filter(asset => asset.kind === 'diagram' || asset.kind === 'infographic')).toHaveLength(0);
	});

	it('selects and naturally inserts no more than three internal and one external link', async () => {
		let state = await runStateBlock(SelectArticleLinks, {
			...LINK_CANDIDATES,
			request: {
				imagePolicy: {
					bodyImageCount: 3,
					paidExtraImageAllowance: 0,
					requireDiagram: true,
				},
			},
			articlePlan: ARTICLE_PLAN,
		});
		const linkPlan = requiredObject(state.linkPlan, 'state.linkPlan');

		expect(requiredObjectArray(linkPlan.internal, 'linkPlan.internal')).toHaveLength(3);
		expect(requiredObjectArray(linkPlan.external, 'linkPlan.external')).toHaveLength(1);

		state = await runStateBlock(PlanArticleImages, state);
		state = await runStateBlock(WriteArticle, state);
		state = await runStateBlock(GenerateImages, state);
		state = await runStateBlock(PlaceImages, state);
		state = await runStateBlock(WeaveArticleLinks, state);
		state = await runStateBlock(FinalizeArticle, state);

		const draft = requiredObject(state.draft, 'state.draft');
		const markdown = String(draft.markdown);
		const insertedLinks = requiredObjectArray(state.insertedLinks, 'state.insertedLinks');
		const placedImages = requiredObjectArray(state.placedImages, 'state.placedImages');
		const review = requiredObject(state.review, 'state.review');

		expect(insertedLinks.filter(link => link.kind === 'internal')).toHaveLength(3);
		expect(insertedLinks.filter(link => link.kind === 'external')).toHaveLength(1);
		expect(placedImages).toHaveLength(4);
		expect(markdown).not.toContain('{{image:');
		expect(markdown).toContain('[background job lifecycle](https://site.example.test/background-jobs)');
		expect(markdown).toContain('[independent workflow reliability research](https://partner.example.test/reliability)');
		expect(review.status).toBe('approved');
		expect(review.metrics).toEqual({
			titleImages: 1,
			bodyImages: 3,
			diagrams: 1,
			internalLinks: 3,
			externalLinks: 1,
		});
	});

	it('rejects an unplanned link introduced directly into final markdown', async () => {
		let state = await runStateBlock(SelectArticleLinks, {
			...LINK_CANDIDATES,
			request: {
				imagePolicy: {
					bodyImageCount: 2,
					paidExtraImageAllowance: 0,
					requireDiagram: false,
				},
			},
			articlePlan: ARTICLE_PLAN,
		});

		state = await runStateBlock(PlanArticleImages, state);
		state = await runStateBlock(WriteArticle, state);
		state = await runStateBlock(GenerateImages, state);
		state = await runStateBlock(PlaceImages, state);
		state = await runStateBlock(WeaveArticleLinks, state);

		const draft = requiredObject(state.draft, 'state.draft');

		state = {
			...state,
			draft: {
				...draft,
				markdown: `${String(draft.markdown)}\n\n[Unplanned source](https://unapproved.example.test/source)`,
			},
		};

		await expect(runStateBlock(FinalizeArticle, state)).rejects.toThrow(/unplanned link|link count/i);
	});
});

/**
 * Creates a compact candidate fixture for selection and link-weaving tests.
 *
 * @param kind - Internal or external link category.
 * @param anchorText - Natural phrase expected in article prose.
 * @param url - Destination URL.
 * @param relevanceScore - Editorial ranking score.
 * @returns JSON-safe candidate fixture.
 */
function candidate(kind: 'internal' | 'external', anchorText: string, url: string, relevanceScore: number): FlowValues {
	return {
		id: `${kind}-${relevanceScore}`,
		kind,
		anchorText,
		url,
		title: anchorText,
		summary: `Supporting context for ${anchorText}.`,
		relevanceScore,
		source: kind === 'internal' ? 'website_content' : 'backlink_exchange',
	};
}

/**
 * Executes one function-backed block with deterministic test context.
 *
 * @param block - Block definition under test.
 * @param input - JSON-safe named block inputs.
 * @returns JSON-safe named block outputs.
 */
async function runBlock(block: FlowBlockDefinition, input: FlowValues): Promise<FlowValues> {
	if (!block.run) throw new Error(`Block ${block.type} does not define run().`);

	return await block.run(input, context);
}

/**
 * Executes a standard article-state block and unwraps its state output.
 *
 * @param block - Article block definition under test.
 * @param state - Evolving article state supplied to the block.
 * @returns Evolving article state returned by the block.
 */
async function runStateBlock(block: FlowBlockDefinition, state: FlowValues): Promise<FlowValues> {
	const output = await runBlock(block, { state });

	return requiredObject(output.state, `${block.type}.state`);
}

/**
 * Requires a JSON object in focused test assertions.
 *
 * @param value - Unknown flow value.
 * @param label - Assertion label included in failures.
 * @returns Parsed flow-value object.
 */
function requiredObject(value: FlowValue | undefined, label: string): FlowValues {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}

	return value;
}

/**
 * Requires an array of JSON objects in focused test assertions.
 *
 * @param value - Unknown flow value.
 * @param label - Assertion label included in failures.
 * @returns Parsed flow-value objects.
 */
function requiredObjectArray(value: FlowValue | undefined, label: string): FlowValues[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);

	return value.map((item, index) => requiredObject(item, `${label}[${index}]`));
}
