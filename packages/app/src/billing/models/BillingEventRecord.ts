import { ActiveRecord, type FieldBuilder } from '../../db';
import type { BillingProviderEvent } from '../contracts';

/** Every verified provider webhook, stored before it is applied, for dedupe, audit and replay. */
export class BillingEventRecord extends ActiveRecord {
	static override table = 'billing_events';
	static override requestFillable: string[] = [];
	static override comment = 'Verified payment provider events; unique by provider event id.';

	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(),
			eventId: field.string({ column: 'event_id', required: true, length: 255, maxLength: 255, unique: true }),
			type: field.string({ required: true, length: 120, maxLength: 120 }),
			event: field.json<BillingProviderEvent>({ required: true }),
			processedAt: field.timestamp({ column: 'processed_at' }),
			error: field.string({ length: 1000, maxLength: 1000 }),
			createdAt: field.timestamp({ column: 'created_at', auto: 'create' }),
		};
	}

	declare id: string;
	declare eventId: string;
	declare type: string;
	declare event: BillingProviderEvent;
	declare processedAt: Date | null;
	declare error: string | null;
	declare createdAt: Date;
}
