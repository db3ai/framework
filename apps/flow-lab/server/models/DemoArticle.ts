import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';

/** Development-only generated article written by a Flow Lab database block. */
export class DemoArticle extends ActiveRecord {
	static override table = 'flow_lab_articles';
	static override primaryKey = 'id';
	static override comment = 'Article output persisted by the isolated Flow Lab article-generation example.';

	/**
	 * Defines the observable article result written by the final database block.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Demo article field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable generated article id.',
			}),
			userId: field.string({
				column: 'user_id',
				required: true,
				length: 26,
				index: true,
				comment: 'Demo user that owns the generated article.',
			}),
			contentPlanId: field.string({
				column: 'content_plan_id',
				required: true,
				length: 26,
				index: true,
				comment: 'Content-plan item that initiated article generation.',
			}),
			title: field.string({
				required: true,
				comment: 'Generated article title.',
			}),
			markdown: field.longText({
				required: true,
				comment: 'Generated article body after image placement.',
			}),
			images: field.stringList({
				required: false,
				default: [],
				comment: 'Generated image URLs placed into the article.',
			}),
			reviewStatus: field.choice({
				column: 'review_status',
				required: true,
				choices: ['approved'],
				comment: 'Result emitted by the review block.',
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare userId: string | null;
	declare contentPlanId: string | null;
	declare title: string | null;
	declare markdown: string | null;
	declare images: string[] | null;
	declare reviewStatus: 'approved' | null;
	declare createdAt: Date | null;
}
