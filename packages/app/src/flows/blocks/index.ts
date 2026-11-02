export * from './FlowInput';
export * from './FlowOutput';
export * from './Subflow';
export * from './control';

import type { FlowBlockDefinition } from '../contracts';
import { FlowInput } from './FlowInput';
import { FlowOutput } from './FlowOutput';
import { Subflow } from './Subflow';
import { ControlIf, ControlSwitch } from './control';

/** Framework blocks safe to import in browsers; see FLOW_SERVER_BLOCKS for all. */
export const FLOW_SYSTEM_BLOCKS: FlowBlockDefinition[] = [FlowInput, FlowOutput, Subflow, ControlSwitch, ControlIf];
export { FLOW_TRIGGER_PORT } from './trigger';
