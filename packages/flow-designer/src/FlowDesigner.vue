<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { FlowBlockInstance, FlowBlockMetadata, FlowConnection, FlowDefinition, FlowValue, FlowValueDefinition, FlowValues } from '@db3.ai/app/flows';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE, SUBFLOW_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';
import { ChevronRight, Play, Save, Workflow } from '@lucide/vue';
import { ulid } from '@db3.ai/pure/ulid';

import FlowCanvas from './FlowCanvas.vue';
import FlowInspector from './FlowInspector.vue';
import FlowRunInputForm from './FlowRunInputForm.vue';
import FlowRunPanel from './FlowRunPanel.vue';
import type { FlowDesignerClient, FlowRunDetailsRecord, FlowRunRecord } from './contracts';
import { metadataForInstance } from './flowMetadata';
import { insertBlockOnConnection } from './graphOperations';

const BLOCK_DRAG_TYPE = 'application/x-platform-flow-block';
const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);

const props = withDefaults(defineProps<{
	client: FlowDesignerClient;
	title?: string;
	initialFlowId?: string;
}>(), {
	title: 'Flow Designer',
	initialFlowId: undefined,
});

const flows = ref<Awaited<ReturnType<FlowDesignerClient['catalog']>>['flows']>([]);
const blocks = ref<FlowBlockMetadata[]>([]);
const definition = shallowRef<FlowDefinition | null>(null);
const revision = ref<string | null>(null);
const sourcePath = ref<string | null>(null);
const dirty = ref(false);
const selectedBlockId = ref<string | null>(null);
const selectedConnectionId = ref<string | null>(null);
const runs = ref<FlowRunRecord[]>([]);
const runDetails = shallowRef<FlowRunDetailsRecord | null>(null);
const runInput = ref<FlowValues>({});
const runInputValid = ref(true);
const busy = ref(false);
const loading = ref(true);
const error = ref<string | null>(null);
const breadcrumbs = ref<Array<{ id: string; name: string; runId?: string }>>([]);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const selectedBlock = computed(() => definition.value?.blocks.find(block => block.id === selectedBlockId.value) ?? null);
const selectedMetadata = computed(() => (
	definition.value && selectedBlock.value
		? metadataForInstance(selectedBlock.value, definition.value, blocks.value, flows.value)
		: null
));
const selectedConnection = computed<FlowConnection | null>(() => (
	definition.value?.connections.find(connection => connection.id === selectedConnectionId.value) ?? null
));

onMounted(loadCatalog);
onBeforeUnmount(stopPolling);

/**
 * Loads the designer catalog and opens its requested or first flow.
 */
async function loadCatalog(): Promise<void> {
	loading.value = true;
	error.value = null;

	try {
		const catalog = await props.client.catalog();

		flows.value = catalog.flows;
		blocks.value = catalog.blocks;

		const flowId = props.initialFlowId ?? catalog.flows[0]?.id;

		if (flowId) await openFlow(flowId, true);
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		loading.value = false;
	}
}

/**
 * Loads one definition and its recent run history.
 *
 * @param flowId - Source definition ULID.
 * @param resetBreadcrumbs - Whether this is a top-level navigation.
 * @param requestedRunId - Optional linked run to display with the definition.
 */
async function openFlow(flowId: string, resetBreadcrumbs = false, requestedRunId?: string): Promise<void> {
	stopPolling();
	busy.value = true;
	error.value = null;

	try {
		const [stored, recentRuns] = await Promise.all([
			props.client.definition(flowId),
			props.client.runs(flowId),
		]);

		definition.value = structuredClone(stored.definition);
		revision.value = stored.revision;
		sourcePath.value = stored.path ?? null;
		dirty.value = false;
		selectedBlockId.value = null;
		selectedConnectionId.value = null;
		runs.value = recentRuns;
		runDetails.value = null;
		runInput.value = initialInput(stored.definition);
		runInputValid.value = true;

		const crumb = { id: stored.definition.id, name: stored.definition.name, ...(requestedRunId ? { runId: requestedRunId } : {}) };

		if (resetBreadcrumbs) {
			breadcrumbs.value = [crumb];
		} else {
			const existingIndex = breadcrumbs.value.findIndex(item => item.id === crumb.id);

			breadcrumbs.value = existingIndex >= 0
				? breadcrumbs.value.slice(0, existingIndex + 1)
				: [...breadcrumbs.value, crumb];
		}

		if (requestedRunId || recentRuns[0]) {
			await selectRun(requestedRunId ?? recentRuns[0].id);
		}
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		busy.value = false;
	}
}

/**
 * Opens an existing nested definition or creates one for a new placeholder.
 *
 * When a parent run is selected, navigation follows the exact linked child run
 * so breadcrumbs preserve the observed execution hierarchy.
 *
 * @param blockId - Flow-backed block occurrence selected on the canvas.
 */
async function openNestedBlock(blockId: string): Promise<void> {
	if (!definition.value) return;

	const block = definition.value.blocks.find(candidate => candidate.id === blockId);

	if (!block || (selectedMetadataFor(block)?.kind ?? 'function') !== 'flow') return;

	const nestedRunId = runDetails.value?.steps.find(step => step.blockId === block.id)?.nestedRun ?? undefined;

	if (block.flowId) {
		await openFlow(block.flowId, false, nestedRunId);
		return;
	}

	if (block.type !== SUBFLOW_BLOCK_TYPE) return;

	busy.value = true;
	error.value = null;

	try {
		const child = createSubflowDefinition(block.name || 'New Subflow');

		await props.client.save(child);

		const parent = structuredClone(definition.value);
		const parentBlock = parent.blocks.find(candidate => candidate.id === block.id);

		if (!parentBlock) throw new Error('Subflow placeholder no longer exists.');

		parentBlock.flowId = child.id;

		const storedParent = await props.client.save(parent, revision.value ?? undefined);

		definition.value = structuredClone(storedParent.definition);
		revision.value = storedParent.revision;
		sourcePath.value = storedParent.path ?? null;
		dirty.value = false;
		await refreshCatalog();
		await openFlow(child.id, false);
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		busy.value = false;
	}
}

/**
 * Creates the initial source graph behind a newly opened subflow placeholder.
 *
 * @param name - Developer-facing child flow name.
 * @returns Definition containing connected public input and output boundaries.
 */
function createSubflowDefinition(name: string): FlowDefinition {
	const inputId = ulid();
	const outputId = ulid();

	return {
		schemaVersion: 1,
		id: ulid(),
		name,
		description: 'Nested flow created from the visual designer.',
		inputs: {
			value: {
				type: 'json',
				required: true,
				editor: { label: 'Value' },
			},
		},
		outputs: {
			value: {
				type: 'json',
				required: true,
				editor: { label: 'Value' },
			},
		},
		blocks: [
			{
				id: inputId,
				type: FLOW_INPUT_BLOCK_TYPE,
				name: 'Inputs',
				position: { x: 80, y: 160 },
			},
			{
				id: outputId,
				type: FLOW_OUTPUT_BLOCK_TYPE,
				name: 'Outputs',
				position: { x: 560, y: 160 },
			},
		],
		connections: [{
			id: ulid(),
			sourceBlockId: inputId,
			sourcePort: 'value',
			targetBlockId: outputId,
			targetPort: 'value',
		}],
	};
}

/**
 * Resolves effective metadata for a block in the currently open definition.
 *
 * @param block - Block occurrence requiring designer metadata.
 * @returns Resolved metadata or null.
 */
function selectedMetadataFor(block: FlowBlockInstance): FlowBlockMetadata | null {
	return definition.value
		? metadataForInstance(block, definition.value, blocks.value, flows.value)
		: null;
}

/**
 * Replaces the current in-memory source definition after a graph operation.
 *
 * @param nextDefinition - Complete updated source definition.
 */
function updateDefinition(nextDefinition: FlowDefinition): void {
	definition.value = nextDefinition;
	dirty.value = true;

	if (selectedConnectionId.value && !nextDefinition.connections.some(connection => connection.id === selectedConnectionId.value)) {
		selectedConnectionId.value = null;
	}
}

/**
 * Updates one configured block occurrence.
 *
 * @param nextBlock - Complete updated block occurrence.
 */
function updateBlock(nextBlock: FlowBlockInstance): void {
	if (!definition.value) return;

	const nextDefinition = structuredClone(definition.value);
	const index = nextDefinition.blocks.findIndex(block => block.id === nextBlock.id);

	if (index < 0) return;

	nextDefinition.blocks[index] = nextBlock;
	updateDefinition(nextDefinition);
}

/**
 * Removes one block and every attached connection.
 *
 * @param blockId - Block occurrence ULID to remove.
 */
function deleteBlock(blockId: string): void {
	if (!definition.value) return;

	const nextDefinition = structuredClone(definition.value);

	nextDefinition.blocks = nextDefinition.blocks.filter(block => block.id !== blockId);
	nextDefinition.connections = nextDefinition.connections.filter(connection => (
		connection.sourceBlockId !== blockId && connection.targetBlockId !== blockId
	));
	selectedBlockId.value = null;
	updateDefinition(nextDefinition);
}

/**
 * Inserts one compatible registered block into a selected connection.
 *
 * @param connectionId - Serialized connection ULID to replace.
 * @param type - Registered block type to insert.
 */
function insertBlock(connectionId: string, type: string): void {
	if (!definition.value) return;

	const metadata = blocks.value.find(block => block.type === type);

	if (!metadata) return;

	try {
		const result = insertBlockOnConnection(definition.value, connectionId, metadata, blocks.value);

		updateDefinition(result.definition);
		selectedConnectionId.value = null;
		selectedBlockId.value = result.blockId;
	} catch (caught) {
		error.value = errorMessage(caught);
	}
}

/**
 * Removes one selected connection from the serialized source graph.
 *
 * @param connectionId - Connection ULID to remove.
 */
function deleteConnection(connectionId: string): void {
	if (!definition.value) return;

	const nextDefinition = structuredClone(definition.value);

	nextDefinition.connections = nextDefinition.connections.filter(connection => connection.id !== connectionId);
	selectedConnectionId.value = null;
	updateDefinition(nextDefinition);
}

/**
 * Saves the complete source graph through the host definition provider.
 */
async function saveDefinition(): Promise<void> {
	if (!definition.value) return;

	busy.value = true;
	error.value = null;

	try {
		const stored = await props.client.save(definition.value, revision.value ?? undefined);

		definition.value = structuredClone(stored.definition);
		revision.value = stored.revision;
		sourcePath.value = stored.path ?? null;
		dirty.value = false;
		await refreshCatalog();
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		busy.value = false;
	}
}

/**
 * Starts a new durable run from the current persisted flow definition.
 */
async function startRun(): Promise<void> {
	if (!definition.value || !runInputValid.value) return;

	busy.value = true;
	error.value = null;

	try {
		if (dirty.value) await saveDefinition();

		const run = await props.client.run(definition.value.id, runInput.value);

		await refreshRuns();
		await selectRun(run.id);
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		busy.value = false;
	}
}

/**
 * Loads and displays one historical or active run.
 *
 * @param runId - Durable run ULID.
 */
async function selectRun(runId: string): Promise<void> {
	stopPolling();

	try {
		runDetails.value = await props.client.runDetails(runId);

		const currentCrumb = breadcrumbs.value[breadcrumbs.value.length - 1];

		if (currentCrumb?.id === runDetails.value.run.flowId) {
			currentCrumb.runId = runId;
		}

		if (ACTIVE_RUN_STATUSES.has(runDetails.value.run.status)) {
			schedulePoll(runId);
		}
	} catch (caught) {
		error.value = errorMessage(caught);
	}
}

/**
 * Replays one run and begins observing the new invocation.
 *
 * @param runId - Historical run ULID.
 * @param definitionSource - Snapshot or latest definition source.
 */
async function replayRun(runId: string, definitionSource: 'original' | 'latest'): Promise<void> {
	busy.value = true;
	error.value = null;

	try {
		const run = await props.client.replay(runId, definitionSource);

		await refreshRuns();
		await selectRun(run.id);
	} catch (caught) {
		error.value = errorMessage(caught);
	} finally {
		busy.value = false;
	}
}

/**
 * Schedules the next active-run refresh without overlapping requests.
 *
 * @param runId - Active run ULID.
 */
function schedulePoll(runId: string): void {
	pollTimer = setTimeout(async () => {
		try {
			runDetails.value = await props.client.runDetails(runId);

			if (ACTIVE_RUN_STATUSES.has(runDetails.value.run.status)) {
				schedulePoll(runId);
				return;
			}

			await refreshRuns();
		} catch (caught) {
			error.value = errorMessage(caught);
		}
	}, 350);
}

/**
 * Cancels any pending active-run refresh.
 */
function stopPolling(): void {
	if (!pollTimer) return;

	clearTimeout(pollTimer);
	pollTimer = null;
}

/**
 * Reloads recent runs for the open source definition.
 */
async function refreshRuns(): Promise<void> {
	if (!definition.value) return;

	runs.value = await props.client.runs(definition.value.id);
}

/**
 * Reloads definition summaries after a name or source change.
 */
async function refreshCatalog(): Promise<void> {
	const catalog = await props.client.catalog();

	flows.value = catalog.flows;
	blocks.value = catalog.blocks;
}

/**
 * Places registered block metadata onto the browser drag payload.
 *
 * @param event - Native drag-start event.
 * @param type - Registered block type.
 */
function startBlockDrag(event: DragEvent, type: string): void {
	if (!event.dataTransfer) return;

	event.dataTransfer.effectAllowed = 'copy';
	event.dataTransfer.setData(BLOCK_DRAG_TYPE, type);
}

/**
 * Creates editor values from public input defaults and primitive types.
 *
 * @param source - Loaded flow definition.
 * @returns Initial run input values.
 */
function initialInput(source: FlowDefinition): FlowValues {
	return Object.fromEntries(Object.entries(source.inputs).map(([name, schema]) => [
		name,
		schema.default ?? defaultValue(schema),
	]));
}

/**
 * Returns a practical empty editor value for an input schema.
 *
 * @param schema - Public input schema.
 * @returns JSON-safe empty value.
 */
function defaultValue(schema: FlowValueDefinition): FlowValue {
	switch (schema.type) {
		case 'number': return 0;
		case 'boolean': return false;
		case 'array': return [];
		case 'object':
		case 'json': return {};
		default: return '';
	}
}

/**
 * Normalizes unknown exceptions for the visible error banner.
 *
 * @param caught - Unknown rejected value.
 * @returns Human-readable error text.
 */
function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}
</script>

<template>
	<div class="flow-designer-shell">
		<header class="flow-designer-toolbar">
			<div class="flow-designer-brand">
				<Workflow :size="19" />
				<strong>{{ title }}</strong>
			</div>

			<nav v-if="breadcrumbs.length" class="flow-breadcrumbs" aria-label="Flow hierarchy">
				<template v-for="(crumb, index) in breadcrumbs" :key="crumb.id">
					<ChevronRight v-if="index" :size="14" />
					<button type="button" @click="openFlow(crumb.id, index === 0, crumb.runId)">{{ crumb.name }}</button>
				</template>
			</nav>

			<button class="flow-command-button is-primary flow-run-command" type="button" :disabled="busy || !runInputValid" @click="startRun">
				<Play :size="15" fill="currentColor" />
				Run
			</button>

			<button
				class="flow-command-button"
				type="button"
				:disabled="busy || !dirty"
				:title="sourcePath ? `Save ${sourcePath}` : 'Save flow definition'"
				@click="saveDefinition"
			>
				<Save :size="15" />
				{{ dirty ? 'Save' : 'Saved' }}
			</button>
		</header>

		<div v-if="error" class="flow-error-banner" role="alert">{{ error }}</div>

		<div v-if="loading" class="flow-designer-loading">Loading flow definitions...</div>
		<div v-else-if="!definition" class="flow-designer-loading">No flow definitions are available.</div>

		<template v-else>
			<div class="flow-designer-workspace">
				<aside class="flow-library">
					<section>
						<h2>Flows</h2>
						<button
							v-for="flow in flows"
							:key="flow.id"
							type="button"
							class="flow-library__flow"
							:class="{ 'is-selected': flow.id === definition.id }"
							@click="openFlow(flow.id, true)"
						>
							<strong>{{ flow.name }}</strong>
							<small>{{ flow.path }}</small>
						</button>
					</section>

					<section>
						<h2>Run input</h2>
						<FlowRunInputForm
							:key="definition.id"
							v-model="runInput"
							:definitions="definition.inputs"
							@validation="runInputValid = $event"
						/>
					</section>

					<section>
						<h2>Blocks</h2>
						<div
							v-for="block in blocks"
							:key="block.type"
							class="flow-library__block"
							draggable="true"
							@dragstart="startBlockDrag($event, block.type)"
						>
							<strong>{{ block.name }}</strong>
							<small>{{ block.type }}</small>
						</div>
					</section>
				</aside>

				<main class="flow-designer-main">
					<FlowCanvas
						:definition="definition"
						:blocks="blocks"
						:flows="flows"
						:run-details="runDetails"
						:selected-connection-id="selectedConnectionId"
						@update:definition="updateDefinition"
						@select-block="selectedBlockId = $event"
						@select-connection="selectedConnectionId = $event"
						@open-block="openNestedBlock"
					/>
					<FlowRunPanel
						:runs="runs"
						:details="runDetails"
						:busy="busy"
						@select-run="selectRun"
						@select-block="selectedBlockId = $event"
						@replay-run="replayRun"
					/>
				</main>

				<FlowInspector
					:definition="definition"
					:block="selectedBlock"
					:connection="selectedConnection"
					:metadata="selectedMetadata"
					:blocks="blocks"
					:flows="flows"
					:run-details="runDetails"
					@update:block="updateBlock"
					@update:flow="updateDefinition"
					@delete:block="deleteBlock"
					@insert:block="insertBlock"
					@delete:connection="deleteConnection"
				/>
			</div>
		</template>
	</div>
</template>
