import type { FlowBlockInstance, FlowBlockMetadata, FlowDefinition, FlowDefinitionSummary } from '@db3.ai/app/flows';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE, SUBFLOW_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';

/**
 * Resolves the effective designer metadata for one configured block occurrence.
 *
 * Structural boundary ports come from the containing definition. Generic subflow
 * ports come from the referenced child summary, matching runtime compilation.
 *
 * @param instance - Block occurrence being rendered or inspected.
 * @param definition - Open source definition containing the occurrence.
 * @param blocks - Registered block metadata catalog.
 * @param flows - Available flow summaries with public contracts.
 * @returns Effective metadata or null for an unknown block type.
 */
export function metadataForInstance(
	instance: FlowBlockInstance,
	definition: FlowDefinition,
	blocks: FlowBlockMetadata[],
	flows: FlowDefinitionSummary[],
): FlowBlockMetadata | null {
	const registered = blocks.find(block => block.type === instance.type);

	if (!registered) return null;

	if (instance.type === FLOW_INPUT_BLOCK_TYPE) {
		return {
			...registered,
			inputs: definition.inputs,
			outputs: definition.inputs,
		};
	}

	if (instance.type === FLOW_OUTPUT_BLOCK_TYPE) {
		return {
			...registered,
			inputs: definition.outputs,
			outputs: definition.outputs,
		};
	}

	if (instance.type === SUBFLOW_BLOCK_TYPE && instance.flowId) {
		const child = flows.find(flow => flow.id === instance.flowId);

		if (child) {
			return {
				...registered,
				name: child.name,
				description: child.description ?? registered.description,
				inputs: child.inputs,
				outputs: child.outputs,
			};
		}
	}

	return registered;
}
