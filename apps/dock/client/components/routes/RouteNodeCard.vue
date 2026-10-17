<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';

import type { ContainerAction } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { formatMemory } from '../../dock/presentation.js';
import { containerStatus, isRunning, requestSummary } from '../../hosts/presentation.js';
import { ROUTE_LAYOUT, type RouteNode } from '../../routes/buildRouteGraph.js';
import Icon from '../Icon.vue';
import RoleTile from '../hosts/RoleTile.vue';

/**
 * One box in the Routes view: a hostname, tunnel, proxy, slot or container.
 * Containers inside an expanded slot are compact rows. Every container box has
 * restart and stop/start controls, so the diagram can manage what it shows.
 */
const props = defineProps<{ node: RouteNode; selected: boolean; expanded: boolean }>();
const emit = defineEmits<{ toggle: []; action: [action: ContainerAction] }>();

const { now } = useDockContext();
const status = computed(() => (props.node.container ? containerStatus(props.node.container, now.value) : null));
const running = computed(() => !!props.node.container && isRunning(props.node.container));
const busy = computed(() => !!props.node.container?.pending);

const STATE_LABEL = { live: 'Live', standby: 'Standby', idle: 'Not routed', broken: 'Down' } as const;

const second = computed(() => {
	const { node } = props;
	if (node.slot) return [`${node.slot.running}/${node.slot.total} running`, node.sublabel].filter(Boolean).join(' · ');
	if (node.container) {
		const traffic = requestSummary(node.container);
		const load = node.container.state === 'running' && node.container.cpu !== null ? `${node.container.cpu.toFixed(1)}% · ${formatMemory(node.container.memory)}` : null;
		// Load last: it appears as the box is widened.
		return [node.sublabel, traffic ?? node.container.detail, load].filter(Boolean).join(' · ');
	}
	return node.sublabel;
});
const problem = computed(() => {
	const { node } = props;
	if (node.slot?.problem) return node.slot.problem;
	if (node.container && node.container.state !== 'running') return node.container.state;
	if (node.container?.health === 'unhealthy') return 'unhealthy';
	return null;
});
const icon = computed(() => (props.node.kind === 'hostname' || props.node.kind === 'catch-all' ? 'web' : props.node.kind === 'port' ? 'api' : props.node.kind === 'missing' ? 'alert' : 'server'));
</script>

<template>
	<div
		v-if="props.node.parent && props.node.container"
		class="card card--member"
		:class="[`card--${props.node.state}`, { 'card--selected': props.selected }]"
		:style="{ width: `${props.node.width}px`, height: `${props.node.height}px` }"
		:title="`${props.node.sublabel}\n${props.node.container.command}`"
	>
		<Handle type="target" :position="Position.Left" :connectable="false" />
		<RoleTile :role="props.node.container.role" size="sm" :dimmed="!running" />
		<span class="member-text">
			<span class="label">{{ props.node.label }}</span>
			<span class="second mono" :class="`tone--${status!.tone}`">{{ status!.label }}</span>
		</span>
		<!-- Load keeps its own column, so it shows however narrow the box is. -->
		<span v-if="running" class="load mono" :title="`CPU ${props.node.container.cpu?.toFixed(1) ?? '—'}% · memory ${formatMemory(props.node.container.memory)}`">
			<span>{{ props.node.container.cpu !== null ? `${props.node.container.cpu.toFixed(1)}%` : '—' }}</span>
			<span>{{ formatMemory(props.node.container.memory) }}</span>
		</span>
		<span class="actions">
			<button type="button" class="act nodrag" :disabled="busy" :aria-label="`Restart ${props.node.sublabel}`" title="Restart" @click.stop="emit('action', 'restart')"><Icon name="restart" :size="12" /></button>
			<button type="button" class="act nodrag" :disabled="busy" :aria-label="`${running ? 'Stop' : 'Start'} ${props.node.sublabel}`" :title="running ? 'Stop' : 'Start'" @click.stop="emit('action', running ? 'stop' : 'start')"><Icon :name="running ? 'stop' : 'play'" :size="11" /></button>
		</span>
		<Handle type="source" :position="Position.Right" :connectable="false" />
	</div>
	<div
		v-else
		class="card"
		:class="[`card--${props.node.state}`, { 'card--selected': props.selected, 'card--clickable': !!props.node.select, 'card--group': props.node.members.length }, props.node.slot ? `card--slot-${props.node.slot.label}` : '']"
		:style="{ width: `${props.node.width}px`, [props.node.members.length ? 'height' : 'minHeight']: `${props.node.height}px` }"
		:title="props.node.container?.description ?? undefined"
	>
		<Handle type="target" :position="Position.Left" :connectable="false" />
		<div class="top">
			<RoleTile v-if="props.node.container" :role="props.node.container.role" size="sm" />
			<span v-else class="glyph"><Icon :name="icon" :size="13" /></span>
			<span class="label" :class="{ mono: props.node.kind !== 'catch-all' }" :title="props.node.label">{{ props.node.label }}</span>
			<span v-if="props.node.kind === 'slot' || props.node.kind === 'container'" class="pill" :class="`pill--${props.node.state}`">{{ STATE_LABEL[props.node.state] }}</span>
		</div>
		<div v-if="second || problem || props.node.container" class="row">
			<div class="second mono" :title="second ?? undefined">
				<span v-if="problem" class="problem">{{ problem }}</span>
				<span v-if="problem && second"> · </span>
				<span>{{ second }}</span>
			</div>
			<span v-if="props.node.container" class="actions">
				<button type="button" class="act nodrag" :disabled="busy" :aria-label="`Restart ${props.node.container.name}`" title="Restart" @click.stop="emit('action', 'restart')"><Icon name="restart" :size="12" /></button>
				<button type="button" class="act nodrag" :disabled="busy" :aria-label="`${running ? 'Stop' : 'Start'} ${props.node.container.name}`" :title="running ? 'Stop' : 'Start'" @click.stop="emit('action', running ? 'stop' : 'start')"><Icon :name="running ? 'stop' : 'play'" :size="11" /></button>
			</span>
		</div>
		<button v-if="props.node.slot" type="button" class="toggle nodrag" :aria-expanded="props.expanded" @click.stop="emit('toggle')">
			{{ props.expanded ? 'Hide containers' : `Show ${props.node.slot.total} containers` }}
		</button>
		<button v-else-if="props.node.container?.proxy?.servers.length" type="button" class="toggle nodrag" :aria-expanded="props.expanded" @click.stop="emit('toggle')">
			{{ props.expanded ? 'Hide rules' : 'Show rules' }}
		</button>
		<ol v-if="props.node.rules.length" class="rules mono">
			<li v-for="rule in props.node.rules" :key="rule.path" :class="`rule--${rule.state}`" :title="`${rule.path}\n→ ${rule.target}${rule.fallback ? `\non error ${rule.fallback}` : ''}`">
				<span class="path">{{ rule.path }}</span>
				<span class="target">→ {{ rule.target }}</span>
				<span v-if="rule.fallback" class="fallback">on error {{ rule.fallback }}</span>
			</li>
		</ol>
		<Handle type="source" :position="Position.Right" :connectable="false" />
	</div>
</template>

<style scoped>
.card {
	box-sizing: border-box;
	padding: 9px 11px;
	border-radius: 10px;
	border: 1px solid var(--line-strong);
	border-left-width: 3px;
	background: var(--panel);
	color: var(--text);
	font-family: var(--sans);
	font-size: 12px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	text-align: left;
}

.card--clickable {
	cursor: pointer;
}

.card--live {
	border-left-color: var(--ok);
}

.card--standby {
	border-left-color: var(--warn);
	border-style: dashed solid dashed solid;
}

.card--broken {
	border-color: color-mix(in srgb, var(--bad) 55%, transparent);
	border-left-color: var(--bad);
	background: var(--crashed);
}

.card--idle {
	border-left-color: var(--faint);
}

.card--selected {
	box-shadow: 0 0 0 2px var(--link);
}

/* An expanded slot is a frame for its containers, in its own colour. */
.card--group {
	background: color-mix(in srgb, var(--panel) 70%, transparent);
}

.card--slot-blue {
	border-left-color: var(--kind-api);
}

.card--slot-green {
	border-left-color: var(--ok);
}

.card--member {
	flex-direction: row;
	align-items: center;
	gap: 8px;
	padding: 5px 8px;
	border-left-width: 2px;
	cursor: pointer;
}

.load {
	flex: none;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	min-width: 52px;
	font-size: 10.5px;
	line-height: 14px;
	color: var(--text-2);
	font-variant-numeric: tabular-nums;
}

.load span + span {
	color: var(--muted);
}

.member-text {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 1px;
}

.row {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.row .second {
	flex: 1;
	min-width: 0;
}

.actions {
	flex: none;
	display: flex;
	gap: 2px;
}

.act {
	width: 22px;
	height: 22px;
	border-radius: 5px;
	border: 1px solid var(--line);
	background: var(--raised);
	color: var(--text-2);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	padding: 0;
}

.act:hover:not(:disabled) {
	background: var(--raised-hi);
	color: var(--text);
}

.tone--ok {
	color: var(--ok);
}

.tone--busy {
	color: var(--warn);
}

.top {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}

.glyph {
	width: 22px;
	height: 22px;
	flex: none;
	border-radius: 6px;
	background: var(--raised);
	color: var(--muted);
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.label {
	flex: 1;
	min-width: 0;
	font-weight: 600;
	font-size: 12.5px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.label.mono {
	font-weight: 500;
}

.pill {
	flex: none;
	font-size: 9.5px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	border-radius: 999px;
	padding: 1px 6px;
	color: var(--muted);
	background: var(--raised);
}

.pill--live {
	color: var(--ok);
	background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill--standby {
	color: var(--warn);
	background: color-mix(in srgb, var(--warn) 14%, transparent);
}

.pill--broken {
	color: var(--bad);
	background: color-mix(in srgb, var(--bad) 14%, transparent);
}

.second {
	font-size: 11px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.problem {
	color: var(--bad);
}

.toggle {
	height: 14px;
	line-height: 14px;
	align-self: flex-start;
	border: 0;
	background: transparent;
	padding: 0;
	color: var(--link);
	font-size: 11px;
}

.rules {
	list-style: none;
	margin: 4px 0 0;
	padding: 6px 0 0;
	border-top: 1px solid var(--line-soft);
	display: flex;
	flex-direction: column;
	font-size: 10.5px;
}

/* Fixed line heights: the layout reserves exactly this much room (ROUTE_LAYOUT). */
.rules li {
	padding: 1px 0;
}

.rules span {
	display: block;
	height: 15px;
	line-height: 15px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.path {
	color: var(--text-2);
}

.target {
	color: var(--muted);
}

.rule--broken .target {
	color: var(--bad);
}

.target,
.fallback {
	padding-left: 10px;
}

.fallback {
	color: var(--warn);
}

/* Edges attach to the sides; the handles themselves stay out of sight. */
.card :deep(.vue-flow__handle) {
	opacity: 0;
	width: 1px;
	height: 1px;
	min-width: 0;
	min-height: 0;
	border: 0;
}
</style>
