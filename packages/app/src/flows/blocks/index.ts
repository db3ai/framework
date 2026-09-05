export * from './FlowInput';
export * from './FlowOutput';
export * from './Subflow';

import type { FlowBlockDefinition } from '../contracts';
import { FlowInput } from './FlowInput';
import { FlowOutput } from './FlowOutput';
import { Subflow } from './Subflow';

/** Framework-owned structural blocks registered for every flow service. */
export const FLOW_SYSTEM_BLOCKS: FlowBlockDefinition[] = [FlowInput, FlowOutput, Subflow];
