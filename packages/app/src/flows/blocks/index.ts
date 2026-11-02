export * from './FlowInput';
export * from './FlowOutput';
export * from './Subflow';
export * from './control';
export * from './flowCall';

import type { FlowBlockDefinition } from '../contracts';
import { FlowInput } from './FlowInput';
import { FlowOutput } from './FlowOutput';
import { Subflow } from './Subflow';
import { ControlIf, ControlSwitch } from './control';
import { FlowRunBlock, FlowStartBlock } from './flowCall';

/** Browser-safe framework blocks; FLOW_SERVER_BLOCKS has all. */
export const FLOW_SYSTEM_BLOCKS: FlowBlockDefinition[] = [FlowInput, FlowOutput, Subflow, ControlSwitch, ControlIf, FlowRunBlock, FlowStartBlock];
export { FLOW_TRIGGER_PORT } from './trigger';
