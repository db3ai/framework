import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';

/** Development-only content plan item consumed by article pipeline examples. */
export class DemoContentPlan extends ActiveRecord {
	static override table = 'flow_lab_content_plans';
	static override primaryKey = 'id';
	static override comment = 'Isolated Flow Lab content plan used by article and daily scheduling examples.';

	/**
	 * Defines persisted article intent and scheduling state.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Demo content-plan field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable demo content-plan id.',
			}),
			userId: field.string({
				column: 'user_id',
				required: true,
				length: 26,
				index: true,
				comment: 'Demo user whose website owns the planned content.',
			}),
			targetKeyword: field.string({
				column: 'target_keyword',
				required: true,
				comment: 'Primary keyword researched by the article flow.',
			}),
			plannedDate: field.string({
				column: 'planned_date',
				required: true,
				length: 10,
				index: true,
				comment: 'ISO date used by the daily planner.',
			}),
			brief: field.text({
				required: true,
				comment: 'Editorial intent supplied to context and planning blocks.',
			}),
			status: field.choice({
				required: true,
				choices: ['planned', 'generated'],
				default: 'planned',
				index: true,
				comment: 'Whether an article has been saved for this plan.',
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare userId: string | null;
	declare targetKeyword: string | null;
	declare plannedDate: string | null;
	declare brief: string | null;
	declare status: 'planned' | 'generated' | null;
	declare createdAt: Date | null;
}
