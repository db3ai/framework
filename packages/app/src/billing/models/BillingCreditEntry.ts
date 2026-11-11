import { ActiveRecord, type FieldBuilder } from '../../db';

/** One signed change to a credit bucket; the balance is the sum. `key` makes each change apply once. */
export class BillingCreditEntry extends ActiveRecord {
	static override table = 'billing_credit_entries';
	static override requestFillable: string[] = [];
	static override comment = 'Prepaid credit ledger: positive grants, negative spends and reversals.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			accountId: field.string({ column: 'account_id', required: true, length: 26, maxLength: 26, indexes: [{ name: 'billing_credit_balance', columns: ['account_id', 'bucket'] }] }),
			bucket: field.string({ required: true, length: 120, maxLength: 120 }),
			amount: field.integer({ required: true, comment: 'Credits; negative for spends and reversals.' }),
			key: field.string({ required: true, length: 255, maxLength: 255, unique: true }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string;
	declare accountId: string;
	declare bucket: string;
	declare amount: number;
	declare key: string;
	declare createdAt: Date;
}
