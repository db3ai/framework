import { FLOW_SERVER_BLOCKS } from '../flows/blocks/server';
import type { AnyFlowDefinition, FlowBlockDefinition, FlowBlockMetadata, FlowDefinitionSummary, FlowDefinitionWriteOptions, StoredFlowDefinition } from '../flows/contracts';
import { FileFlowDefinitionStore } from '../flows/drivers/FileFlowDefinitionStore';
import { FlowBlockRegistry } from '../flows/FlowBlockRegistry';
import { ConsoleError } from './ConsoleError';

/** What the console's Flows screens need: an app's `Flows` service has all of it. */
export interface ConsoleFlows {
	listDefinitions(): Promise<FlowDefinitionSummary[]>;
	definition(id: string): Promise<StoredFlowDefinition>;
	saveDefinition(definition: AnyFlowDefinition, options?: FlowDefinitionWriteOptions): Promise<StoredFlowDefinition>;
	blockMetadata(): FlowBlockMetadata[];
}

/**
 * The flow files in a repo folder such as `<repo>/db3/flows`, for a host that edits them without
 * running the app. The palette has the framework's own blocks plus any passed in; the app checks
 * its own blocks when it loads the flows.
 *
 * @param root - Folder holding the flow files.
 * @param blocks - More blocks for the palette.
 */
export function fileFlows(root: string, blocks: FlowBlockDefinition[] = []): ConsoleFlows {
	const store = new FileFlowDefinitionStore({ root });
	const registry = new FlowBlockRegistry([...FLOW_SERVER_BLOCKS, ...blocks]);
	return {
		listDefinitions: () => store.list(),
		async definition(id) {
			const summary = (await store.list()).find(item => item.id === id || (item.schemaVersion === 2 && item.name === id));
			const stored = summary ? await store.read(summary.id) : null;
			if (!stored) throw new ConsoleError('That flow does not exist.', 404);
			return stored;
		},
		saveDefinition: (definition, options) => store.write(definition, options),
		blockMetadata: () => registry.metadata(),
	};
}
