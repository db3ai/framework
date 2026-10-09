<script setup lang="ts">
import { nextTick, shallowRef, watch } from 'vue';
import type { FlowBlockMetadata, FlowDefinition, FlowDefinitionSummary } from '@db3.ai/app/flows';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';
import { ulid } from '@db3.ai/pure/ulid';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import { MarkerType, VueFlow, useVueFlow, type Connection, type Edge, type EdgeChange, type EdgeMouseEvent, type Node, type NodeChange, type NodeDragEvent, type NodeMouseEvent, type VueFlowStore } from '@vue-flow/core';

import FlowBlockNode from './FlowBlockNode.vue';
import FlowBoundaryNode from './FlowBoundaryNode.vue';
import type { FlowNodeData } from './FlowNodeData';
import type { FlowRunDetailsRecord } from './contracts';
import { metadataForInstance } from './flowMetadata';

const BLOCK_DRAG_TYPE = 'application/x-platform-flow-block';

const props = defineProps<{
	definition: FlowDefinition;
	blocks: FlowBlockMetadata[];
	flows: FlowDefinitionSummary[];
	runDetails: FlowRunDetailsRecord | null;
	selectedConnectionId: string | null;
}>();

const emit = defineEmits<{
	'update:definition': [definition: FlowDefinition];
	'select-block': [blockId: string | null];
	'select-connection': [connectionId: string | null];
	'open-block': [blockId: string];
}>();

const flowId = `platform-flow-${ulid()}`;
const nodes = shallowRef<Node<FlowNodeData>[]>([]);
const edges = shallowRef<Edge[]>([]);
const { screenToFlowCoordinate } = useVueFlow(flowId);

watch(
	() => [props.definition, props.blocks, props.runDetails] as const,
	rebuildGraph,
	{ deep: true, immediate: true },
);

/**
 * Rebuilds Vue Flow elements from the serialized definition and selected run.
 */
function rebuildGraph(): void {
	const steps = new Map((props.runDetails?.steps ?? []).map(step => [step.blockId, step]));

	const nextNodes: Node<FlowNodeData>[] = [];

	for (const instance of props.definition.blocks) {
		const block = metadataForInstance(instance, props.definition, props.blocks, props.flows);

		if (!block) continue;

		nextNodes.push({
			id: instance.id,
			type: instance.type === FLOW_INPUT_BLOCK_TYPE || instance.type === FLOW_OUTPUT_BLOCK_TYPE
				? 'flow-boundary'
				: 'flow-block',
			position: { ...instance.position },
			data: {
				instance,
				metadata: block,
				step: steps.get(instance.id) ?? null,
			},
			dragHandle: '.flow-block-node__header',
			ariaLabel: instance.name || block.name,
		});
	}

	nodes.value = nextNodes;

	edges.value = props.definition.connections.map(connection => {
		const targetStep = steps.get(connection.targetBlockId);
		const active = targetStep?.status === 'queued' || targetStep?.status === 'running';

		return {
			id: connection.id,
			source: connection.sourceBlockId,
			target: connection.targetBlockId,
			sourceHandle: connection.sourcePort,
			targetHandle: connection.targetPort,
			type: 'smoothstep',
			animated: active,
			markerEnd: MarkerType.ArrowClosed,
			class: active ? 'is-active' : '',
			selected: connection.id === props.selectedConnectionId,
		};
	});
}

/**
 * Fits a freshly loaded graph into the available canvas.
 *
 * @param store - Initialized Vue Flow store.
 */
async function handleInit(store: VueFlowStore): Promise<void> {
	await nextTick();
	await store.fitView({
		padding: 0.16,
		maxZoom: 0.95,
	});
}

/**
 * Persists one dragged node position into the source definition.
 *
 * @param event - Completed node drag event.
 */
function handleNodeDragStop(event: NodeDragEvent): void {
	const definition = structuredClone(props.definition);
	const block = definition.blocks.find(candidate => candidate.id === event.node.id);

	if (!block) return;

	block.position = {
		x: Math.round(event.node.position.x),
		y: Math.round(event.node.position.y),
	};
	emit('update:definition', definition);
}

/**
 * Selects a block when its graph node is clicked.
 *
 * @param event - Vue Flow node mouse event.
 */
function handleNodeClick(event: NodeMouseEvent): void {
	emit('select-connection', null);
	emit('select-block', event.node.id);
}

/**
 * Selects a serialized connection when its graph edge is clicked.
 *
 * @param event - Vue Flow edge mouse event.
 */
function handleEdgeClick(event: EdgeMouseEvent): void {
	emit('select-block', null);
	emit('select-connection', event.edge.id);
}

/**
 * Clears graph selections when the empty canvas is clicked.
 */
function handlePaneClick(): void {
	emit('select-block', null);
	emit('select-connection', null);
}

/**
 * Opens a nested definition when a configured subflow node is double-clicked.
 *
 * @param event - Vue Flow node mouse event.
 */
function handleNodeDoubleClick(event: NodeMouseEvent): void {
	const instance = props.definition.blocks.find(block => block.id === event.node.id);

	if (instance) emit('open-block', instance.id);
}

/**
 * Adds a serialized named-port connection to the source definition.
 *
 * @param connection - Connection created by Vue Flow.
 */
function handleConnect(connection: Connection): void {
	if (!connection.sourceHandle || !connection.targetHandle) return;

	const duplicate = props.definition.connections.some(existing => (
		existing.sourceBlockId === connection.source
		&& existing.sourcePort === connection.sourceHandle
		&& existing.targetBlockId === connection.target
		&& existing.targetPort === connection.targetHandle
	));

	if (duplicate) return;

	const definition = structuredClone(props.definition);

	definition.connections.push({
		id: ulid(),
		sourceBlockId: connection.source,
		sourcePort: connection.sourceHandle,
		targetBlockId: connection.target,
		targetPort: connection.targetHandle,
	});
	emit('update:definition', definition);
}

/**
 * Mirrors keyboard edge deletion into the serialized definition.
 *
 * @param changes - Vue Flow edge changes.
 */
function handleEdgesChange(changes: EdgeChange[]): void {
	const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));

	if (removed.size === 0) return;

	const definition = structuredClone(props.definition);

	definition.connections = definition.connections.filter(connection => !removed.has(connection.id));
	emit('update:definition', definition);
}

/**
 * Mirrors keyboard node deletion into the serialized definition.
 *
 * @param changes - Vue Flow node changes.
 */
function handleNodesChange(changes: NodeChange[]): void {
	const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));

	if (removed.size === 0) return;

	const definition = structuredClone(props.definition);

	definition.blocks = definition.blocks.filter(block => !removed.has(block.id));
	definition.connections = definition.connections.filter(connection => (
		!removed.has(connection.sourceBlockId)
		&& !removed.has(connection.targetBlockId)
	));
		emit('select-block', null);
		emit('select-connection', null);
		emit('update:definition', definition);
}

/**
 * Allows registered block metadata to be dropped onto the graph canvas.
 *
 * @param event - Native drag-over event.
 */
function handleDragOver(event: DragEvent): void {
	if (!event.dataTransfer?.types.includes(BLOCK_DRAG_TYPE)) return;

	event.preventDefault();
	event.dataTransfer.dropEffect = 'copy';
}

/**
 * Creates a configured block occurrence at the dropped graph coordinate.
 *
 * @param event - Native drop event carrying a block type.
 */
function handleDrop(event: DragEvent): void {
	const type = event.dataTransfer?.getData(BLOCK_DRAG_TYPE);
	const metadata = props.blocks.find(block => block.type === type);

	if (!type || !metadata) return;

	event.preventDefault();

	const position = screenToFlowCoordinate({
		x: event.clientX,
		y: event.clientY,
	});
	const config = Object.fromEntries(Object.entries(metadata.config ?? {}).flatMap(([name, definition]) => (
		definition.default === undefined ? [] : [[name, structuredClone(definition.default)]]
	)));
	const definition = structuredClone(props.definition);
	const blockId = ulid();

	definition.blocks.push({
		id: blockId,
		type,
		name: metadata.name,
		...(Object.keys(config).length ? { config } : {}),
		position: {
			x: Math.round(position.x),
			y: Math.round(position.y),
		},
	});
	emit('update:definition', definition);
	emit('select-block', blockId);
}
</script>

<template>
	<div class="flow-canvas" @drop="handleDrop" @dragover="handleDragOver">
		<VueFlow
			:id="flowId"
			v-model:nodes="nodes"
			v-model:edges="edges"
			:apply-default="true"
			:delete-key-code="['Backspace', 'Delete']"
			:fit-view-on-init="false"
			:min-zoom="0.2"
			:max-zoom="1.6"
			:connection-radius="36"
			@init="handleInit"
			@connect="handleConnect"
			@node-click="handleNodeClick"
			@edge-click="handleEdgeClick"
			@pane-click="handlePaneClick"
			@node-double-click="handleNodeDoubleClick"
			@node-drag-stop="handleNodeDragStop"
			@nodes-change="handleNodesChange"
			@edges-change="handleEdgesChange"
		>
			<Background :gap="20" :size="1" color="#d7dde3" />
			<Controls position="bottom-left" />
			<MiniMap position="bottom-right" :pannable="true" :zoomable="true" />

			<template #node-flow-block="nodeProps">
				<FlowBlockNode v-bind="nodeProps" />
			</template>

			<template #node-flow-boundary="nodeProps">
				<FlowBoundaryNode v-bind="nodeProps" />
			</template>
		</VueFlow>
	</div>
</template>
