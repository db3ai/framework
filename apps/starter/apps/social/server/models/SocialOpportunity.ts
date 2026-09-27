import { ActiveRecord } from '@db3.ai/app/db';
import type { SocialOpportunityData } from '../../shared/SocialOpportunityData.js';

/** Private discussion bookmark owned by a host-authenticated person. */
export class SocialOpportunity extends ActiveRecord.define({
	table: 'social_opportunities',

	/** Defines portable app-owned storage; host identity is a reference rather than a duplicate user table. */
	fields(field) {
		return {
			id: field.ulid(),
			owner: field.string({ column: 'owner_id', required: true, length: 26, index: true }),
			title: field.string({ required: true, length: 200, maxLength: 200 }),
			url: field.string({ required: true, length: 2048, maxLength: 2048 }),
			notes: field.text({ required: true, maxLength: 4000 }),
			status: field.string({ required: true, length: 16, default: 'saved' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	},
}) {
	/** Narrows the model's field-owned serialization to the public discussion contract. */
	override toJSON(): Record<string, unknown> & SocialOpportunityData {
		return super.toJSON() as Record<string, unknown> & SocialOpportunityData;
	}
}
