<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { MarkerType, VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/controls/dist/style.css';

import type { HostSnapshot } from '../../../shared/hostContracts.js';
import type { ContainerAction, ContainerSnapshot } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { confirmAction } from '../../hosts/presentation.js';
import { buildRouteGraph, focusOn, ROUTE_WIDTH_RANGE, type RouteNode, type RouteState } from '../../routes/buildRouteGraph.js';
import Icon from '../Icon.vue';
import RouteNodeCard from './RouteNodeCard.vue';

/**
 * How requests reach the containers on one server, as a diagram (vue-flow):
 * hostnames and published ports → tunnels → proxies → slots and containers.
 *
 * Read-only and built entirely from the server snapshot by `buildRouteGraph`,
 * so it holds no data of its own. Clicking a box selects that container in the
 * panel below, as the list does.
 */
const props = defineProps<{ host: HostSnapshot; filter: string }>();

const { dock, layout } = useDockContext();
const flowId = computed(() => `routes-${props.host.id}`);
const { fitView } = useVueFlow(flowId.value);
const expanded = reactive(new Set<string>());

const graph = computed(() => buildRouteGraph(props.host, { expanded, filter: props.filter, width: layout.routeWidth }));
const selectedName = computed(() => (layout.selectedContainer?.startsWith(`${props.host.id}/`) ? layout.selectedContainer.slice(props.host.id.length + 1) : null));

/**
 * The box whose routes stand out: the one under the pointer, else the one
 * clicked (any box, hostnames included), else the selected container's.
 * Everything off its routes fades, so lines sharing a path can be told apart.
 */
const hovered = ref<string | null>(null);
const pinned = ref<string | null>(null);
const focusId = computed(() => {
	const ids = new Set(graph.value.nodes.map(item => item.id));
	for (const id of [hovered.value, pinned.value]) if (id && ids.has(id)) return id;
	return graph.value.nodes.find(item => item.select && item.select === selectedName.value && item.kind !== 'slot')?.id ?? null;
});
/** What stays bright around the focused box; everything else fades. */
const focus = computed(() => (focusId.value ? focusOn(graph.value, focusId.value) : null));

// vue-flow needs a group's node before the nodes inside it.
const nodes = computed<Node<RouteNode>[]>(() => [...graph.value.nodes].sort((a, b) => Number(!!a.parent) - Number(!!b.parent)).map(item => ({
	id: item.id,
	type: 'route',
	...(item.parent ? { parentNode: item.parent, extent: 'parent' as const } : {}),
	class: focus.value && !focus.value.nodes.has(item.id) ? 'faded' : undefined,
	position: { x: item.x, y: item.y },
	data: item,
	draggable: false,
	selectable: false,
	connectable: false,
})));

// Live lines are neutral and move; colour is kept for blue/green slots, standby and faults.
const COLOURS: Record<RouteState, string> = { live: 'var(--text-2)', standby: 'var(--warn)', idle: 'var(--faint)', broken: 'var(--bad)' };
/** Lines into a blue or green slot match it, as the slot names do in the list; a broken route stays red. */
const TINTS = { blue: 'var(--kind-api)', green: 'var(--ok)' } as const;

const edges = computed<Edge[]>(() => graph.value.edges.map(item => {
	const off = !!focus.value && !focus.value.edges.has(item.id);
	const on = !!focus.value && !off;
	const colour = item.tint && item.state !== 'broken' ? TINTS[item.tint] : COLOURS[item.state];
	return {
		id: item.id,
		source: item.source,
		target: item.target,
		// Curves fan in from each source; stepped lines would share one channel.
		type: 'default',
		animated: item.state === 'live' && !off,
		class: off ? 'faded' : undefined,
		zIndex: on ? 1 : 0,
		style: { stroke: colour, strokeWidth: on ? 2.4 : item.state === 'live' ? 1.8 : 1.3, strokeDasharray: item.state === 'standby' ? '5 4' : undefined },
		markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
		selectable: false,
	};
}));

/** Fits the whole diagram in view; only on request, so the view never moves under you. */
function fit(): void {
	void fitView({ padding: 0.12, duration: 200 });
}

function select(node: RouteNode): void {
	// A second click on the focused box lets go of it.
	pinned.value = pinned.value === node.id ? null : node.id;
	if (node.select && pinned.value) layout.selectedContainer = `${props.host.id}/${node.select}`;
}

/**
 * Expands a proxy's rules (by container name) or a slot's containers (by
 * compose project). Opening a slot also focuses it, as selecting it would;
 * closing it lets go.
 */
function toggle(key: string, slot = false): void {
	if (expanded.has(key)) {
		expanded.delete(key);
		if (slot && pinned.value === `slot:${key}`) pinned.value = null;
	} else {
		expanded.add(key);
		if (slot) pinned.value = `slot:${key}`;
	}
}

function act(container: ContainerSnapshot, action: ContainerAction): void {
	const question = confirmAction(container, action, props.host.name);
	if (question && !window.confirm(question)) return;
	void dock.containerAction(props.host.id, container.name, action);
}
</script>

<template>
	<div class="routes">
		<p v-if="!graph.nodes.length" class="none">
			{{ props.filter ? `No routes match “${props.filter}”.` : 'No routes found: no tunnels with known ingress, nginx proxies or published ports on this server yet.' }}
		</p>
		<VueFlow
			v-else
			:id="flowId"
			:nodes="nodes"
			:edges="edges"
			:nodes-draggable="false"
			:nodes-connectable="false"
			:elements-selectable="false"
			:zoom-on-double-click="false"
			:min-zoom="0.2"
			:max-zoom="2"
			fit-view-on-init
			@node-click="({ node }) => select(node.data)"
			@node-mouse-enter="({ node }) => (hovered = node.id)"
			@node-mouse-leave="hovered = null"
			@pane-click="pinned = null"
		>
			<template #node-route="{ data }">
				<RouteNodeCard
					:node="data"
					:selected="!!data.select && data.select === selectedName && (data.kind !== 'slot' || !data.members.length)"
					:expanded="expanded.has(data.slot?.id ?? data.container?.name ?? '')"
					@toggle="data.slot ? toggle(data.slot.id, true) : toggle(data.container.name)"
					@action="act(data.container, $event)"
				/>
			</template>
			<Background :gap="22" :size="1" pattern-color="var(--line)" />
			<Controls position="bottom-left" :show-interactive="false" />
		</VueFlow>
		<div v-if="graph.nodes.length" class="toolbar">
			<label class="width">
				<span>Box width</span>
				<input v-model.number="layout.routeWidth" type="range" :min="ROUTE_WIDTH_RANGE.min" :max="ROUTE_WIDTH_RANGE.max" step="10">
			</label>
			<button type="button" class="btn fit" title="Fit the whole diagram in view" @click="fit"><Icon name="maximize" :size="12" /> Fit</button>
		</div>
		<div class="legend" aria-hidden="true">
			<span><i class="line line--live" /> live (moving)</span>
			<span><i class="line line--standby" /> previous upstream</span>
			<span><i class="line line--idle" /> not routed</span>
			<span><i class="line line--broken" /> down</span>
			<span><i class="line line--blue" /><i class="line line--green" /> into blue / green</span>
		</div>
	</div>
</template>

<style scoped>
.routes {
	position: relative;
	flex: 1 0 420px;
	min-height: 420px;
	border: 1px solid var(--line);
	border-radius: 12px;
	background: var(--ground-deep);
	overflow: hidden;
}

.routes :deep(.vue-flow) {
	height: 100%;
}

.none {
	margin: 24px;
	color: var(--muted);
}

/* vue-flow's controls, in Dock's colours for light and dark. */
.routes :deep(.vue-flow__controls) {
	box-shadow: none;
	border: 1px solid var(--line);
	border-radius: 8px;
	overflow: hidden;
}

.routes :deep(.vue-flow__controls-button) {
	background: var(--panel);
	border-bottom: 1px solid var(--line-soft);
	color: var(--text-2);
	fill: currentColor;
}

.routes :deep(.vue-flow__controls-button:hover) {
	background: var(--raised);
}

.routes :deep(.vue-flow__controls-button svg) {
	fill: currentColor;
}

.routes :deep(.vue-flow__node.faded),
.routes :deep(.vue-flow__edge.faded) {
	opacity: 0.15;
	transition: opacity 0.15s;
}

.routes :deep(.vue-flow__node-route) {
	padding: 0;
	border: 0;
	background: transparent;
}

.toolbar {
	position: absolute;
	top: 10px;
	right: 12px;
	z-index: 5;
	display: flex;
	align-items: center;
	gap: 6px;
}

.fit {
	height: 30px;
	background: var(--panel);
}

.width {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 10px;
	border-radius: 8px;
	border: 1px solid var(--line);
	background: var(--panel);
	font-size: 11.5px;
	color: var(--muted);
}

.width input {
	width: 110px;
	accent-color: var(--link);
}

.legend {
	position: absolute;
	right: 12px;
	bottom: 10px;
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	padding: 6px 10px;
	border-radius: 8px;
	border: 1px solid var(--line);
	background: var(--panel);
	font-size: 11.5px;
	color: var(--muted);
}

.line {
	display: inline-block;
	width: 18px;
	height: 0;
	vertical-align: middle;
	margin-right: 4px;
	border-top: 2px solid;
}

.line--live {
	border-color: var(--text-2);
}

.line--standby {
	border-color: var(--warn);
	border-top-style: dashed;
}

.line--idle {
	border-color: var(--faint);
}

.line--broken {
	border-color: var(--bad);
}

.line--blue {
	border-color: var(--kind-api);
	width: 10px;
}

.line--green {
	border-color: var(--ok);
	width: 10px;
}
</style>
