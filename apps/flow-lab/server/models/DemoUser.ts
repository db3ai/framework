import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';

/** Development-only user record used by executable Flow Lab examples. */
export class DemoUser extends ActiveRecord {
	static override table = 'flow_lab_users';
	static override primaryKey = 'id';
	static override comment = 'Isolated Flow Lab user fixture used to demonstrate explicit database read blocks.';

	/**
	 * Defines the small user context consumed by article-generation examples.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Demo user field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable demo user id.',
			}),
			name: field.string({
				required: true,
				comment: 'Person requesting generated content.',
			}),
			email: field.email({
				required: true,
				comment: 'Contact email included in fetched user context.',
			}),
			company: field.string({
				required: true,
				comment: 'Business name used to build article context.',
			}),
			audience: field.text({
				required: true,
				comment: 'Target audience guidance used by writing blocks.',
			}),
			createdAt: field.timestamp({
				column: 'created_at',
				auto: 'create',
			}),
		};
	}

	declare id: string | null;
	declare name: string | null;
	declare email: string | null;
	declare company: string | null;
	declare audience: string | null;
	declare createdAt: Date | null;
}
