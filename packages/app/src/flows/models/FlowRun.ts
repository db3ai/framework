import { ActiveRecord, type FieldBuilder } from '../../db';
import type { EntityRef } from '../../db/fields/LinkField';
import { FLOW_REPLAY_DEFINITION, FLOW_RUN_STATUS, type FlowReplayDefinition, type FlowRunStatus } from '../constants';
import type { FlowErrorSnapshot, FlowExecutionDefinition, FlowValues } from '../contracts';

/**
 * Durable invocation of one immutable flow definition snapshot.
 */
export class FlowRun extends ActiveRecord {
	static override table = 'flow_runs';
	static override primaryKey = 'id';
	static override labelFields = ['flowName', 'status'];
	static override comment = 'Durable flow invocation and immutable definition snapshot used for observability and replay.';

	/**
	 * Defines persisted flow-run identity, snapshot, lifecycle, and result fields.
	 *
	 * @param field - ActiveRecord field builder.
	 * @returns Flow run field definitions.
	 */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid({
				comment: 'Stable flow run ULID.',
			}),

			flowId: field.string({
				column: 'flow_id',
				required: true,
				length: 26,
				maxLength: 26,
				index: true,
				comment: 'Stable ULID from the source flow definition.',
			}),

			flowName: field.string({
				column: 'flow_name',
				required: true,
				length: 255,
				maxLength: 255,
				comment: 'Flow name captured when this run was created.',
			}),

			status: field.choice({
				required: true,
				choices: Object.values(FLOW_RUN_STATUS),
				default: FLOW_RUN_STATUS.queued,
				length: 20,
				maxLength: 20,
				index: true,
				comment: 'Current durable lifecycle state for the flow invocation.',
			}),

			replayDefinition: field.choice({
				column: 'replay_definition',
				required: false,
				choices: Object.values(FLOW_REPLAY_DEFINITION),
				length: 20,
				maxLength: 20,
				comment: 'Definition source selected when this run replays an earlier invocation.',
			}),

			definitionRevision: field.string({
				column: 'definition_revision',
				required: true,
				length: 64,
				maxLength: 64,
				index: true,
				comment: 'SHA-256 revision of the source definition used for this run.',
			}),

			definitionSnapshot: field.jsonLongText<FlowExecutionDefinition>({
				column: 'definition_snapshot',
				required: true,
				comment: 'Immutable normalized flow definition executed by this run.',
			}),

			input: field.jsonLongText<FlowValues>({
				required: true,
				comment: 'Validated public input supplied to the root block.',
			}),

			output: field.jsonLongText<FlowValues>({
				required: false,
				comment: 'Validated public output produced by the terminal block.',
			}),

			error: field.jsonLongText<FlowErrorSnapshot>({
				required: false,
				comment: 'Structured terminal error when the run fails.',
			}),

			replayOf: field.link(() => FlowRun, {
				column: 'replay_of_run_id',
				required: false,
				onDelete: 'SET NULL',
				index: true,
				comment: 'Earlier flow run replayed by this invocation, when applicable.',
			}),

			parentRun: field.link(() => FlowRun, {
				column: 'parent_run_id',
				required: false,
				onDelete: 'CASCADE',
				index: true,
				comment: 'Parent flow run waiting for this nested invocation.',
			}),

			parentBlockId: field.string({
				column: 'parent_block_id',
				required: false,
				length: 26,
				maxLength: 26,
				index: true,
				comment: 'Flow-backed block occurrence in the parent run.',
			}),

			startedAt: field.timestamp({
				column: 'started_at',
				precision: 3,
				index: true,
				comment: 'Time the first block began execution.',
			}),

			completedAt: field.timestamp({
				column: 'completed_at',
				precision: 3,
				index: true,
				comment: 'Time the run completed or failed.',
			}),

			createdAt: field.timestamp({
				column: 'created_at',
				precision: 3,
				auto: 'create',
				index: true,
			}),

			updatedAt: field.timestamp({
				column: 'updated_at',
				precision: 3,
				auto: 'update',
			}),
		};
	}

	declare id: string | null;
	declare flowId: string | null;
	declare flowName: string | null;
	declare status: FlowRunStatus | null;
	declare replayDefinition: FlowReplayDefinition | null;
	declare definitionRevision: string | null;
	declare definitionSnapshot: FlowExecutionDefinition | null;
	declare input: FlowValues | null;
	declare output: FlowValues | null;
	declare error: FlowErrorSnapshot | null;
	declare replayOf: EntityRef<FlowRun> | null;
	declare parentRun: EntityRef<FlowRun> | null;
	declare parentBlockId: string | null;
	declare startedAt: Date | null;
	declare completedAt: Date | null;
	declare createdAt: Date | null;
	declare updatedAt: Date | null;
}
