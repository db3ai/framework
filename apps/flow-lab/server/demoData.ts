import { DemoContentPlan, DemoUser, DemoWebsitePage } from './models/index.js';

/** Stable user id referenced by committed example definitions. */
export const DEMO_USER_ID = '01KXDVYBKJFHDBTEH2J8MQC25D';

/** Stable content-plan id referenced by committed example definitions. */
export const DEMO_CONTENT_PLAN_ID = '01KXDVYBKM23VQ2DTETC09YM4R';

/** Stable partner user id whose pages can participate in backlink exchange. */
export const DEMO_PARTNER_USER_ID = '01KY015KYGB21XRGRGCF6KWRT8';

interface DemoWebsitePageSeed extends Record<string, unknown> {
	/** Stable page id retained across Flow Lab resets. */
	id: string;
	/** Demo website owner used to distinguish internal and external pages. */
	ownerUserId: string;
	/** Absolute destination URL. */
	url: string;
	/** Editorial title shown during candidate inspection. */
	title: string;
	/** Compact content summary used during selection. */
	summary: string;
	/** Natural anchor phrase expected in the deterministic draft. */
	anchorText: string;
	/** Relevance score used for deterministic ordering. */
	relevanceScore: number;
	/** Whether cross-site selection is permitted. */
	backlinkExchange: boolean;
}

const DEMO_WEBSITE_PAGES: DemoWebsitePageSeed[] = [
	{
		id: '01KY015KYS2J4BS4CSGB9RXPBK',
		ownerUserId: DEMO_USER_ID,
		url: 'https://analytical-engines.example.test/guides/background-jobs',
		title: 'Operating Background Jobs',
		summary: 'Explains queue attempts, worker ownership, and durable job lifecycle state.',
		anchorText: 'background job lifecycle',
		relevanceScore: 95,
		backlinkExchange: false,
	},
	{
		id: '01KY015KYSYTG8MBCW76RSSB9S',
		ownerUserId: DEMO_USER_ID,
		url: 'https://analytical-engines.example.test/guides/agent-observability',
		title: 'Agent Observability',
		summary: 'Shows how traces, tool events, and model requests make agent work inspectable.',
		anchorText: 'agent observability',
		relevanceScore: 92,
		backlinkExchange: false,
	},
	{
		id: '01KY015KYSVHSN6G9A121SEMHH',
		ownerUserId: DEMO_USER_ID,
		url: 'https://analytical-engines.example.test/guides/workflow-replay',
		title: 'Safe Workflow Replay',
		summary: 'Compares original-snapshot replay with running the latest workflow definition.',
		anchorText: 'workflow replay',
		relevanceScore: 89,
		backlinkExchange: false,
	},
	{
		id: '01KY015KYSJDQH8BJM1C1GG7VK',
		ownerUserId: DEMO_USER_ID,
		url: 'https://analytical-engines.example.test/guides/queue-drivers',
		title: 'Choosing Queue Drivers',
		summary: 'Reviews database and Redis-backed execution tradeoffs.',
		anchorText: 'queue driver selection',
		relevanceScore: 72,
		backlinkExchange: false,
	},
	{
		id: '01KY015KYST8J5G8YPGKX64XKW',
		ownerUserId: DEMO_PARTNER_USER_ID,
		url: 'https://systems-lab.example.test/research/reliable-ai-operations',
		title: 'Reliable AI Operations Study',
		summary: 'Independent research into failure recovery and operational confidence for AI workflows.',
		anchorText: 'independent workflow reliability research',
		relevanceScore: 94,
		backlinkExchange: true,
	},
	{
		id: '01KY015KYS5N12D3X1YW5H4CPT',
		ownerUserId: DEMO_PARTNER_USER_ID,
		url: 'https://systems-lab.example.test/benchmarks/ai-observability',
		title: 'AI Observability Benchmarks',
		summary: 'A comparison of useful workflow-level telemetry and debugging signals.',
		anchorText: 'AI observability benchmarks',
		relevanceScore: 86,
		backlinkExchange: true,
	},
	{
		id: '01KY015KYT59FY7VTJWWEN8DZY',
		ownerUserId: DEMO_PARTNER_USER_ID,
		url: 'https://systems-lab.example.test/opinion/opaque-automation',
		title: 'The Case for Opaque Automation',
		summary: 'A deliberately high-scoring page that is not approved for backlink exchange.',
		anchorText: 'opaque automation',
		relevanceScore: 99,
		backlinkExchange: false,
	},
];

/**
 * Seeds the minimum deterministic records needed by executable demo flows.
 */
export async function ensureDemoData(): Promise<void> {
	if (!await DemoUser.findByPk(DEMO_USER_ID)) {
		const user = DemoUser.create({
			id: DEMO_USER_ID,
			name: 'Ada Lovelace',
			email: 'ada@example.test',
			company: 'Analytical Engines Ltd',
			audience: 'Technical founders building dependable AI-assisted products.',
		});

		await user.save();
	}

	if (!await DemoUser.findByPk(DEMO_PARTNER_USER_ID)) {
		const partner = DemoUser.create({
			id: DEMO_PARTNER_USER_ID,
			name: 'Grace Hopper',
			email: 'grace@systems-lab.example.test',
			company: 'Systems Lab',
			audience: 'Engineering leaders operating production AI systems.',
		});

		await partner.save();
	}

	if (!await DemoContentPlan.findByPk(DEMO_CONTENT_PLAN_ID)) {
		const contentPlan = DemoContentPlan.create({
			id: DEMO_CONTENT_PLAN_ID,
			userId: DEMO_USER_ID,
			targetKeyword: 'observable AI workflows',
			plannedDate: '2026-07-14',
			brief: 'Explain how durable step boundaries, replay, and visual flow definitions make background AI systems easier to operate.',
			status: 'planned',
		});

		await contentPlan.save();
	}

	for (const seed of DEMO_WEBSITE_PAGES) {
		await ensureDemoWebsitePage(seed);
	}
}

/**
 * Creates one seeded page when it is absent from the isolated Flow Lab database.
 *
 * @param seed - Stable candidate page attributes.
 */
async function ensureDemoWebsitePage(seed: DemoWebsitePageSeed): Promise<void> {
	if (await DemoWebsitePage.findByPk(seed.id)) return;

	const page = DemoWebsitePage.create(seed);

	await page.save();
}
