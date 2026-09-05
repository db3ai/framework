import { ActiveRecord, type FieldBuilder } from '../../db';
import type { EntityRef } from '../../db/fields/LinkField';
import { FLOW_STEP_STATUS, type FlowStepStatus } from '../constants';
import type { FlowErrorSnapshot, FlowValues } from '../contracts';
import { FlowRun } from './FlowRun';

const FLOW_STEP_RUN_SEQUENCE_UNIQUE = 'flow_step_runs_run_sequence_unique';
const FLOW_STEP_RUN_BLOCK_UNIQUE = 'flow_step_runs_run_block_unique';

/**
 * Durable execution state for one block occurrence within a flow run.
 */
export class FlowStepRun extends ActiveRecord {
	static override table = 'flow_step_runs';
	static override primaryKey = 'id';
	static override labelFields = ['blockName', 'status'];
	static override comment = 'Per-block flow execution input, output, error, queue identity, and timing.';

	/**
	 * Defines the durable per-block execution schema.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Flow step-run field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable flow step-run ULID.',
			}),

			run: field.link(() => FlowRun, {
				column: 'run_id',
				required: true,
				onDelete: 'CASCADE',
				index: true,
				indexes: [
					{
						name: FLOW_STEP_RUN_SEQUENCE_UNIQUE,
						columns: ['run_id', 'sequence'],
						unique: true,
					},
					{
						name: FLOW_STEP_RUN_BLOCK_UNIQUE,
						columns: ['run_id', 'block_id'],
						unique: true,
					},
				],
				comment: 'Flow run that owns this block execution.',
			}),

			blockId: field.string({
				column: 'block_id',
				required: true,
				length: 26,
				maxLength: 26,
				comment: 'Stable block occurrence ULID from the definition snapshot.',
			}),

			blockType: field.string({
				column: 'block_type',
				required: true,
				length: 160,
				maxLength: 160,
				index: true,
				comment: 'Registered executable block type used for this step.',
			}),

			blockName: field.string({
				column: 'block_name',
				required: true,
				length: 255,
				maxLength: 255,
				comment: 'Block instance or type name captured for run history.',
			}),

			sequence: field.integer({
				required: true,
				unsigned: true,
				min: 0,
				comment: 'Zero-based position in the compiled sequential plan.',
			}),

			status: field.choice({
				required: true,
				choices: Object.values(FLOW_STEP_STATUS),
				default: FLOW_STEP_STATUS.pending,
				length: 20,
				maxLength: 20,
				index: true,
				comment: 'Current durable lifecycle state for this block execution.',
			}),

			attempt: field.integer({
				required: true,
				unsigned: true,
				min: 0,
				default: 0,
				comment: 'Most recent queue attempt observed for this step.',
			}),

			queueJobId: field.string({
				column: 'queue_job_id',
				required: false,
				length: 255,
				maxLength: 255,
				index: true,
				comment: 'Driver-owned queue job id for the current step dispatch.',
			}),

			nestedRun: field.link(() => FlowRun, {
				column: 'nested_run_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Child flow run delegated to by this flow-backed block.',
			}),

			input: field.jsonLongText<FlowValues>({
				required: false,
				comment: 'Validated values supplied to the block function.',
			}),

			output: field.jsonLongText<FlowValues>({
				required: false,
				comment: 'Validated values returned by the block function.',
			}),

			error: field.jsonLongText<FlowErrorSnapshot>({
				required: false,
				comment: 'Structured error from the most recent failed attempt.',
			}),

			startedAt: field.timestamp({
				column: 'started_at',
				precision: 3,
				comment: 'Time the current or successful attempt began.',
			}),

			completedAt: field.timestamp({
				column: 'completed_at',
				precision: 3,
				comment: 'Time the step completed or terminally failed.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				precision: 3,
				auto: 'create',
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				precision: 3,
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare run: EntityRef<FlowRun>;
	declare blockId: string | null;
	declare blockType: string | null;
	declare blockName: string | null;
	declare sequence: number | null;
	declare status: FlowStepStatus | null;
	declare attempt: number | null;
	declare queueJobId: string | null;
	declare nestedRun: EntityRef<FlowRun> | null;
	declare input: FlowValues | null;
	declare output: FlowValues | null;
	declare error: FlowErrorSnapshot | null;
	declare startedAt: Date | null;
	declare completedAt: Date | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
