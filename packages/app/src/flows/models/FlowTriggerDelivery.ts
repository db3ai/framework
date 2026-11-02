import { ActiveRecord, type FieldBuilder } from '../../db';
import type { EntityRef } from '../../db/fields/LinkField';
import { FlowRun } from './FlowRun';

const FLOW_TRIGGER_DELIVERY_UNIQUE = 'flow_trigger_deliveries_key_unique';

/**
 * One webhook delivery sent with an `Idempotency-Key`, so a sender's retry returns the
 * first run instead of starting another.
 */
export class FlowTriggerDelivery extends ActiveRecord {
	static override table = 'flow_trigger_deliveries';
	static override primaryKey = 'id';
	static override labelFields = ['trigger'];
	static override comment = 'Webhook deliveries by idempotency key, so retries return the run they started.';

	/**
	 * @param field - Field builder.
	 * @returns Delivery fields.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({ comment: 'Delivery ULID.' }),
			flowId: field.string({
				column: 'flow_id',
				required: true,
				length: 26, maxLength: 26,
				indexes: [{ name: FLOW_TRIGGER_DELIVERY_UNIQUE, columns: ['flow_id', 'trigger', 'idempotency_hash'], unique: true }],
				comment: 'Flow ULID the delivery started.',
			}),
			trigger: field.string({ required: true, length: 64, maxLength: 64, comment: 'Trigger name in the flow file.' }),
			idempotencyHash: field.string({ column: 'idempotency_hash', required: true, length: 64, maxLength: 64, comment: 'SHA-256 of the sender\'s Idempotency-Key.' }),
			payloadHash: field.string({ column: 'payload_hash', required: true, length: 64, maxLength: 64, comment: 'SHA-256 of the canonical JSON body, to refuse a reused key with other inputs.' }),
			run: field.link(() => FlowRun, { column: 'run_id', required: true, onDelete: 'CASCADE', index: true, comment: 'Run the delivery started.' }),
		};
	}

	declare id: string | null;
	declare flowId: string | null;
	declare trigger: string | null;
	declare idempotencyHash: string | null;
	declare payloadHash: string | null;
	declare run: EntityRef<FlowRun> | null;
}
