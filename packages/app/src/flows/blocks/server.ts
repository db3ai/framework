import type { FlowBlockDefinition } from '../contracts';
import { AgentRun } from './agent';
import { FLOW_SYSTEM_BLOCKS } from './index';

export { AGENT_RUN_BLOCK_TYPE, AgentRun } from './agent';

/** Every framework block, including the server-only agent step. */
export const FLOW_SERVER_BLOCKS: FlowBlockDefinition[] = [...FLOW_SYSTEM_BLOCKS, AgentRun];
