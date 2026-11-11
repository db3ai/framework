import { ActiveRecord, type FieldBuilder } from '../../db';
import type { BillingInvoiceLine } from '../contracts';

export type BillingChargeKind = 'invoice' | 'credits';
export type BillingChargeState = 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';

/** One card charge: a monthly usage invoice or a credit pack. */
export class BillingCharge extends ActiveRecord {
	static override table = 'billing_charges';
	static override requestFillable: string[] = [];
	static override comment = 'Monthly usage invoices and credit pack payments, with their provider ids and outcome.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			accountId: field.string({ column: 'account_id', required: true, length: 26, maxLength: 26, index: true }),
			kind: field.choice({ required: true, choices: ['invoice', 'credits'] }),
			idempotencyKey: field.string({ column: 'idempotency_key', required: true, length: 255, maxLength: 255, unique: true, comment: 'invoice:{account}:{YYYY-MM} or credits:{id}; also the provider idempotency key.' }),
			state: field.choice({ required: true, default: 'pending', choices: ['pending', 'paid', 'failed', 'refunded', 'disputed'] }),
			amount: field.integer({ required: true, unsigned: true, comment: 'Minor units.' }),
			currency: field.string({ required: true, length: 3, maxLength: 3 }),
			periodStart: field.timestamp({ column: 'period_start' }),
			lines: field.json<BillingInvoiceLine[]>({}),
			bucket: field.string({ length: 120, maxLength: 120, comment: 'Credit bucket for credit packs.' }),
			credits: field.integer({ unsigned: true, comment: 'Credits granted when paid.' }),
			providerId: field.string({ column: 'provider_id', length: 255, maxLength: 255, unique: true }),
			payUrl: field.string({ column: 'pay_url', length: 2048, maxLength: 2048 }),
			failureReason: field.string({ column: 'failure_reason', length: 255, maxLength: 255 }),
			paidAt: field.timestamp({ column: 'paid_at' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string;
	declare accountId: string;
	declare kind: BillingChargeKind;
	declare idempotencyKey: string;
	declare state: BillingChargeState;
	declare amount: number;
	declare currency: string;
	declare periodStart: Date | null;
	declare lines: BillingInvoiceLine[] | null;
	declare bucket: string | null;
	declare credits: number | null;
	declare providerId: string | null;
	declare payUrl: string | null;
	declare failureReason: string | null;
	declare paidAt: Date | null;
	declare createdAt: Date;
}
