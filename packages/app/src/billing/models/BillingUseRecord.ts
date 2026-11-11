import { ActiveRecord, type FieldBuilder } from '../../db';

/** One counted use of a `use` price; `key` keeps repeated reports from counting twice. */
export class BillingUseRecord extends ActiveRecord {
	static override table = 'billing_uses';
	static override requestFillable: string[] = [];
	static override comment = 'Counted uses of per-use prices.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			accountId: field.string({ column: 'account_id', required: true, length: 26, maxLength: 26, index: true }),
			key: field.string({ required: true, length: 255, maxLength: 255, unique: true }),
			price: field.string({ required: true, length: 120, maxLength: 120 }),
			quantity: field.integer({ required: true, unsigned: true }),
			at: field.timestamp({ required: true, index: true }),
		};
	}

	declare id: string;
	declare accountId: string;
	declare key: string;
	declare price: string;
	declare quantity: number;
	declare at: Date;
}
