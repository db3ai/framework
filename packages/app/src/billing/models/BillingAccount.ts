import { ActiveRecord, type FieldBuilder } from '../../db';
import type { BillingAccountStatus } from '../contracts';

/** One billed owner (for example a Cloud organization): provider customer, saved card and standing. */
export class BillingAccount extends ActiveRecord {
	static override table = 'billing_accounts';
	static override requestFillable: string[] = [];
	static override comment = 'Billing standing, provider customer and saved card per billed owner.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			ownerId: field.string({ column: 'owner_id', required: true, length: 255, maxLength: 255, unique: true, comment: 'App id of the billed owner, for example an organization id.' }),
			providerCustomerId: field.string({ column: 'provider_customer_id', length: 255, maxLength: 255, unique: true, comment: 'Payment provider customer id.' }),
			status: field.choice({ required: true, default: 'none', choices: ['none', 'active', 'past_due', 'suspended'], comment: 'Stored standing; past_due becomes suspended once graceDays pass.' }),
			cardBrand: field.string({ column: 'card_brand', length: 40, maxLength: 40 }),
			cardLast4: field.string({ column: 'card_last4', length: 4, maxLength: 4 }),
			cardExpMonth: field.integer({ column: 'card_exp_month', unsigned: true }),
			cardExpYear: field.integer({ column: 'card_exp_year', unsigned: true }),
			cardFingerprint: field.string({ column: 'card_fingerprint', length: 255, maxLength: 255, index: true, hidden: true, comment: 'Same value for the same card across accounts.' }),
			cardCountry: field.string({ column: 'card_country', length: 2, maxLength: 2 }),
			spendLimit: field.integer({ column: 'spend_limit', unsigned: true, comment: 'Monthly limit override in minor units; null uses the config default.' }),
			autoTopUp: field.json<Record<string, string>>({ column: 'auto_top_up', comment: 'Credit bucket to pack bought automatically when low.' }),
			pastDueSince: field.timestamp({ column: 'past_due_since' }),
			suspendedReason: field.string({ column: 'suspended_reason', length: 255, maxLength: 255 }),
			firstPaidAt: field.timestamp({ column: 'first_paid_at' }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
			updatedAt: field.timestamp({ column: 'updated_at', auto: 'both' }),
		};
	}

	declare id: string;
	declare ownerId: string;
	declare providerCustomerId: string | null;
	declare status: BillingAccountStatus;
	declare cardBrand: string | null;
	declare cardLast4: string | null;
	declare cardExpMonth: number | null;
	declare cardExpYear: number | null;
	declare cardFingerprint: string | null;
	declare cardCountry: string | null;
	declare spendLimit: number | null;
	declare autoTopUp: Record<string, string> | null;
	declare pastDueSince: Date | null;
	declare suspendedReason: string | null;
	declare firstPaidAt: Date | null;
	declare createdAt: Date;
	declare updatedAt: Date;
}
