import type { FlowBlockInstance, FlowBlockMetadata } from '@db3.ai/app/flows';

import type { FlowStepRunRecord } from './contracts';

/** Runtime and definition data rendered by a custom flow block node. */
export interface FlowNodeData {
	/** Configured block occurrence from the source definition. */
	instance: FlowBlockInstance;
	/** Registered block type metadata used for ports and descriptions. */
	metadata: FlowBlockMetadata;
	/** Durable step state for the selected run, when one is active. */
	step: FlowStepRunRecord | null;
}
