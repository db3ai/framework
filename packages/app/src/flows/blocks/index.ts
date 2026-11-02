export * from './control';
export * from './flowCall';

import type { FlowBlockDefinition } from '../contracts';
import { ControlIf, ControlSwitch } from './control';
import { FlowRunBlock, FlowStartBlock } from './flowCall';

/** Browser-safe framework blocks; FLOW_SERVER_BLOCKS has all. */
export const FLOW_SYSTEM_BLOCKS: FlowBlockDefinition[] = [ControlSwitch, ControlIf, FlowRunBlock, FlowStartBlock];
