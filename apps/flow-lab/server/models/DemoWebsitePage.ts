import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';

/** Development-only indexed page used to test internal and exchange link discovery. */
export class DemoWebsitePage extends ActiveRecord {
	static override table = 'flow_lab_website_pages';
	static override primaryKey = 'id';
	static override comment = 'Isolated Flow Lab page candidate used by article link research examples.';

	/**
	 * Defines searchable page ownership, relevance, and backlink-exchange metadata.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Demo website-page field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable demo website-page id.',
			}),
			ownerUserId: field.string({
				column: 'owner_user_id',
				required: true,
				length: 26,
				index: true,
				comment: 'Demo user whose website owns this page.',
			}),
			url: field.url({
				required: true,
				comment: 'Absolute page URL inserted when the candidate is selected.',
			}),
			title: field.string({
				required: true,
				comment: 'Page title shown during editorial candidate selection.',
			}),
			summary: field.text({
				required: true,
				comment: 'Compact page summary used to judge contextual relevance.',
			}),
			anchorText: field.string({
				column: 'anchor_text',
				required: true,
				comment: 'Natural phrase the deterministic writer can place in article copy.',
			}),
			relevanceScore: field.integer({
				column: 'relevance_score',
				required: true,
				min: 0,
				max: 100,
				index: true,
				comment: 'Deterministic relevance score used to rank link candidates.',
			}),
			backlinkExchange: field.boolean({
				column: 'backlink_exchange',
				required: true,
				default: 0,
				index: true,
				comment: 'Whether another website has approved this page for backlink exchange.',
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare ownerUserId: string | null;
	declare url: string | null;
	declare title: string | null;
	declare summary: string | null;
	declare anchorText: string | null;
	declare relevanceScore: number | null;
	declare backlinkExchange: boolean | null;
	declare createdAt: Date | null;
}
