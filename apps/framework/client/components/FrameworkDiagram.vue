<script setup lang="ts">
import { Box, Brain, Clock, Database, Globe, HardDrive, Layers, Send, Shield } from '@lucide/vue';
import { markRaw, type Component } from 'vue';
import { Handle, Position, VueFlow, type Edge, type Node } from '@vue-flow/core';
import { documentationPath } from '../siteRoutes';

/**
 * Marketing metadata rendered inside one framework diagram node.
 */
interface DiagramNodeData extends Record<string, unknown> {
	label: string;
	description: string;
	target: string;
	icon: Component;
	handlePosition: Position;
}

const serviceNodes: Array<Node<DiagramNodeData>> = [
	createNode('web', 'service', 290, 8, 'Web & APIs', 'HTTP · GraphQL · RPC', 'api-reference', Globe, Position.Bottom),
	createNode('data', 'service', 16, 94, 'Data', 'SQL & logical fields', 'active-record', Database, Position.Right),
	createNode('queues', 'service', 16, 198, 'Queues', 'Jobs & events', 'queue-overview', Layers, Position.Right),
	createNode('storage', 'service', 16, 302, 'Storage', 'Files & assets', 'storage', HardDrive, Position.Right),
	createNode('application', 'application', 280, 150, 'Your application', 'One coherent runtime', 'app', Box, Position.Top),
	createNode('auth', 'service', 536, 94, 'Auth', 'Users & teams', 'auth', Shield, Position.Left),
	createNode('scheduler', 'service', 536, 198, 'Scheduler', 'Code-owned schedules', 'scheduler', Clock, Position.Left),
	createNode('delivery', 'service', 536, 302, 'Delivery', 'Email & notifications', 'mail', Send, Position.Left),
	createNode('ai', 'service', 290, 400, 'AI', 'Models & workflows', 'flows', Brain, Position.Top),
];

const serviceEdges: Edge[] = [
	createEdge('web', 'application', 'top'),
	createEdge('data', 'application', 'left'),
	createEdge('queues', 'application', 'left'),
	createEdge('storage', 'application', 'left'),
	createEdge('auth', 'application', 'right'),
	createEdge('scheduler', 'application', 'right'),
	createEdge('delivery', 'application', 'right'),
	createEdge('ai', 'application', 'bottom'),
];

const mobileServiceNodes: Array<DiagramNodeData & { id: string }> = serviceNodes.flatMap(node => {
	if (node.id === 'application' || !node.data) return [];

	return [{ id: node.id, ...node.data }];
});

/**
 * Creates one positioned node for the static marketing diagram.
 *
 * @param id - Stable graph node identifier.
 * @param type - Vue Flow slot used to render the node.
 * @param x - Horizontal graph coordinate.
 * @param y - Vertical graph coordinate.
 * @param label - Reader-facing service name.
 * @param description - Short service capability summary.
 * @param target - Documentation article opened by the node.
 * @param icon - Lucide icon matching the service concept.
 * @param handlePosition - Edge origin used by Vue Flow.
 * @returns Positioned Vue Flow node.
 */
function createNode(id: string, type: string, x: number, y: number, label: string, description: string, target: string, icon: Component, handlePosition: Position): Node<DiagramNodeData> {
	return {
		id,
		type,
		position: { x, y },
		data: {
			label,
			description,
			target,
			icon: markRaw(icon),
			handlePosition,
		},
	};
}

/**
 * Creates one dotted connection into the application runtime.
 *
 * @param source - Service node providing the connection.
 * @param target - Application node receiving the connection.
 * @param targetHandle - Application edge used for the connection.
 * @returns Static Vue Flow edge.
 */
function createEdge(source: string, target: string, targetHandle: string): Edge {
	return {
		id: `${source}-${target}`,
		source,
		target,
		targetHandle,
		type: 'smoothstep',
		style: {
			stroke: 'var(--input)',
			strokeWidth: 1.4,
			strokeDasharray: '4 4',
		},
	};
}

</script>

<template>
	<div class="framework-diagram" aria-label="Framework service architecture">
		<VueFlow
			:nodes="serviceNodes"
			:edges="serviceEdges"
			:nodes-draggable="false"
			:nodes-connectable="false"
			:elements-selectable="false"
			:zoom-on-scroll="false"
			:zoom-on-double-click="false"
			:pan-on-drag="false"
			:prevent-scrolling="false"
			:fit-view-on-init="true"
			:fit-view-options="{ padding: 0.04, maxZoom: 1 }"
			:min-zoom="0.5"
			:max-zoom="1"
		>
			<template #node-service="{ data }">
				<div class="framework-node-shell">
					<Handle type="source" :position="data.handlePosition" />
					<a class="framework-service-node" :href="documentationPath(data.target)" data-docs-navigation>
						<component :is="data.icon" :size="27" :stroke-width="1.7" aria-hidden="true" />
						<span>
							<strong>{{ data.label }}</strong>
							<small>{{ data.description }}</small>
						</span>
					</a>
				</div>
			</template>

			<template #node-application="{ data }">
				<div class="framework-node-shell">
					<Handle id="top" type="target" :position="Position.Top" />
					<Handle id="right" type="target" :position="Position.Right" />
					<Handle id="bottom" type="target" :position="Position.Bottom" />
					<Handle id="left" type="target" :position="Position.Left" />
					<a class="framework-application-node" :href="documentationPath(data.target)" data-docs-navigation>
						<span class="framework-application-cube">
							<Box :size="29" :stroke-width="1.7" aria-hidden="true" />
						</span>
						<strong>{{ data.label }}</strong>
						<small>{{ data.description }}</small>
					</a>
				</div>
			</template>
		</VueFlow>

		<div class="framework-diagram-mobile">
			<a class="framework-mobile-application" :href="documentationPath('app')" data-docs-navigation>
				<Box :size="25" aria-hidden="true" />
				<span><strong>Your application</strong><small>One coherent runtime</small></span>
			</a>
			<div class="framework-mobile-services">
				<a
					v-for="node in mobileServiceNodes"
					:key="node.id"
					class="framework-mobile-service"
					:href="documentationPath(node.target)"
					data-docs-navigation
				>
					<component :is="node.icon" :size="20" aria-hidden="true" />
					<span><strong>{{ node.label }}</strong><small>{{ node.description }}</small></span>
				</a>
			</div>
		</div>
	</div>
</template>
