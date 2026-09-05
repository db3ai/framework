import { ActiveRecord, type FieldBuilder } from '../../db';
import type { EntityRef } from '../../db/fields/LinkField';
import { FLOW_RUN_EVENT_TYPE, type FlowRunEventType } from '../constants';
import type { FlowLogLevel, FlowValue } from '../contracts';
import { FlowRun } from './FlowRun';
import { FlowStepRun } from './FlowStepRun';

const FLOW_RUN_EVENTS_SEQUENCE_UNIQUE = 'flow_run_events_run_sequence_unique';

/**
 * Ordered durable lifecycle or log event emitted during a flow run.
 */
export class FlowRunEvent extends ActiveRecord {
	static override table = 'flow_run_events';
	static override primaryKey = 'id';
	static override labelFields = ['type', 'message'];
	static override comment = 'Ordered flow lifecycle and block log entries used by run timelines.';

	/**
	 * Defines ordered flow event fields and run-local sequence constraints.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Flow run event field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable flow run event ULID.',
			}),

			run: field.link(() => FlowRun, {
				column: 'run_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				indexes: [
					{
						name: FLOW_RUN_EVENTS_SEQUENCE_UNIQUE,
						columns: ['run_id', 'sequence'],
						unique: true,
					},
				],
				comment: 'Flow run that owns this event.',
			}),

			stepRun: field.link(() => FlowStepRun, {
				column: 'step_run_id',
				required: false,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Block step associated with this event, when applicable.',
			}),

			sequence: field.integer({
				required: true,
				unsigned: true,
				min: 0,
				comment: 'Monotonic zero-based ordering within the flow run.',
			}),

			type: field.choice({
				required: true,
				choices: Object.values(FLOW_RUN_EVENT_TYPE),
				length: 40,
				maxLength: 40,
				index: true,
				comment: 'Lifecycle or log event type.',
			}),

			level: field.choice({
				required: false,
				choices: ['debug', 'info', 'warning', 'error'],
				length: 20,
				maxLength: 20,
				comment: 'Optional block log severity.',
			}),

			message: field.string({
				required: true,
				length: 1024,
				maxLength: 1024,
				comment: 'Human-readable timeline or diagnostic message.',
			}),

			data: field.jsonLongText<FlowValue>({
				required: false,
				comment: 'Optional structured event or diagnostic data.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				precision: 3,
				auto: 'create',
				index: true,
			}),
		};
	}

	declare id: string | null;
	declare run: EntityRef<FlowRun>;
	declare stepRun: EntityRef<FlowStepRun> | null;
	declare sequence: number | null;
	declare type: FlowRunEventType | null;
	declare level: FlowLogLevel | null;
	declare message: string | null;
	declare data: FlowValue | null;
	declare createdAt: Date | null;
}
