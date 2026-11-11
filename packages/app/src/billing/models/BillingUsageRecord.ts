import { ActiveRecord, type FieldBuilder } from '../../db';

/** A span of one resource on one `month` or `day` price; `endedAt` is null while it runs. */
export class BillingUsageRecord extends ActiveRecord {
	static override table = 'billing_usage_spans';
	static override requestFillable: string[] = [];
	static override comment = 'Resource run spans billed by hour (month prices) or day; hours are worked out at invoice time.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			accountId: field.string({ column: 'account_id', required: true, length: 26, maxLength: 26, indexes: [{ name: 'billing_usage_open', columns: ['account_id', 'resource_id', 'ended_at'] }] }),
			resourceId: field.string({ column: 'resource_id', required: true, length: 255, maxLength: 255 }),
			price: field.string({ required: true, length: 120, maxLength: 120 }),
			startedAt: field.timestamp({ column: 'started_at', required: true }),
			endedAt: field.timestamp({ column: 'ended_at' }),
		};
	}

	declare id: string;
	declare accountId: string;
	declare resourceId: string;
	declare price: string;
	declare startedAt: Date;
	declare endedAt: Date | null;
}
