<script setup lang="ts">
import { computed } from 'vue';
import { FlowEditor, type FlowDesignerCatalog, type FlowEditorClient } from '@db3.ai/flow-designer';
import '@db3.ai/flow-designer/editor.css';
import type { FlowGraphDefinition, StoredFlowDefinition } from '@db3.ai/app/flows';
import type { ConsoleSource } from './source';

/**
 * The app's flows in the flow editor. Definitions are the app's own files
 * (`db3/flows/<name>.flow.json`), saved with revision checks, so a flow designed here
 * is committed with the app. Runs belong to the running app; this host edits files only,
 * so the editor hides Runs and Test run.
 */
const props = defineProps<{ source: ConsoleSource }>();

const client = computed<FlowEditorClient>(() => ({
	catalog: () => props.source.get<FlowDesignerCatalog>('flows'),
	definition: id => props.source.get<StoredFlowDefinition>(`flows/${encodeURIComponent(id)}`),
	save: (definition: FlowGraphDefinition, expectedRevision?: string) => props.source.send<StoredFlowDefinition>('PUT', `flows/${encodeURIComponent(definition.id)}`, { definition, expectedRevision }),
}));
</script>

<template>
	<section class="h-full min-h-0" data-console-flows>
		<FlowEditor :key="String(client)" :client="client" />
	</section>
</template>
