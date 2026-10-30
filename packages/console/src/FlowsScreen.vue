<script setup lang="ts">
import { computed } from 'vue';
import { FlowDesigner, type FlowDesignerCatalog, type FlowDesignerClient } from '@db3.ai/flow-designer';
import '@db3.ai/flow-designer/style.css';
import type { FlowDefinition, StoredFlowDefinition } from '@db3.ai/app/flows';
import type { ConsoleSource } from './source';

/**
 * The app's flows in the shared flow designer. Definitions are the app's own files (`flow.json`),
 * saved with revision checks, so a flow designed here is committed with the app. Runs are not part
 * of the console yet; the designer says so when asked to run one.
 */
const props = defineProps<{ source: ConsoleSource }>();

const notYet = () => Promise.reject(new Error('Running flows from the console comes later. Run them from the app for now.'));

const client = computed<FlowDesignerClient>(() => ({
	catalog: () => props.source.get<FlowDesignerCatalog>('flows'),
	definition: id => props.source.get<StoredFlowDefinition>(`flows/${encodeURIComponent(id)}`),
	save: (definition: FlowDefinition, expectedRevision?: string) => props.source.send<StoredFlowDefinition>('PUT', `flows/${encodeURIComponent(definition.id)}`, { definition, expectedRevision }),
	runs: async () => [],
	run: notYet,
	runDetails: notYet,
	replay: notYet,
}));
</script>

<template>
	<section class="h-full min-h-0" data-console-flows>
		<FlowDesigner :key="String(client)" :client="client" title="Flows" />
	</section>
</template>
