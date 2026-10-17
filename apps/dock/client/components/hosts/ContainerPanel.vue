<script setup lang="ts">
import { computed } from 'vue';

import type { ContainerSnapshot } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { containerStatus, formatContainerUsage, formatRate, roleMeta } from '../../hosts/presentation.js';
import Icon from '../Icon.vue';
import ContainerDetails from './ContainerDetails.vue';
import LogPane from './LogPane.vue';
import RoleTile from './RoleTile.vue';

/** The selected container, docked below a server's cards: its details or its live logs. */
const props = defineProps<{ container: ContainerSnapshot; hostId: string; containers: Map<string, ContainerSnapshot> }>();
const emit = defineEmits<{ close: []; select: [name: string] }>();

const { layout, now } = useDockContext();
const status = computed(() => containerStatus(props.container, now.value));
/** Load, out of the way on the right: CPU and memory, network in/out, threads. */
const load = computed(() => {
	const container = props.container;
	if (container.state !== 'running') return null;
	const parts = [formatContainerUsage(container)];
	if (container.rxRate !== null) parts.push(`↓${formatRate(container.rxRate)} ↑${formatRate(container.txRate)}`);
	if (container.pids !== null) parts.push(`${container.pids} threads`);
	return parts.join(' · ');
});
</script>

<template>
	<article class="pane" :style="{ borderTopColor: roleMeta(props.container.role).color }" :aria-label="props.container.name">
		<header class="head">
			<RoleTile :role="props.container.role" size="sm" />
			<span class="name">{{ props.container.name }}</span>
			<span class="dot" :class="`dot--${status.tone}`" />
			<span class="status" :class="`tone--${status.tone}`">{{ status.label }}</span>
			<span v-if="load" class="load mono" title="CPU (100% = one core) · memory · network in/out · processes and threads">{{ load }}</span>
			<div class="tabs" role="tablist" aria-label="Panel">
				<button type="button" role="tab" :aria-selected="layout.containerTab === 'details'" :class="{ on: layout.containerTab === 'details' }" @click="layout.containerTab = 'details'">Details</button>
				<button type="button" role="tab" :aria-selected="layout.containerTab === 'logs'" :class="{ on: layout.containerTab === 'logs' }" @click="layout.containerTab = 'logs'">Logs</button>
			</div>
			<button type="button" class="icon-btn icon-btn--ghost close" aria-label="Close panel" title="Close" @click="emit('close')"><Icon name="close" :size="14" /></button>
		</header>
		<ContainerDetails v-if="layout.containerTab === 'details'" :container="props.container" :containers="props.containers" @select="emit('select', $event)" />
		<LogPane v-else :key="props.container.name" :container="props.container" :host-id="props.hostId" />
	</article>
</template>

<style scoped>
.pane {
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: var(--ground-deep);
	border-top: 2px solid transparent;
}

.head {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px 6px 10px;
	border-bottom: 1px solid var(--line-soft);
	background: var(--rail);
	min-height: 44px;
	flex-wrap: wrap;
}

.name {
	font-weight: 600;
	font-size: 13px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
}

.status {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
}

.load {
	margin-left: auto;
	font-size: 11.5px;
	color: var(--faint);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	min-width: 0;
	flex: 0 1 auto;
}

.load + .tabs {
	margin-left: 8px;
}

.tabs {
	margin-left: auto;
	display: flex;
	padding: 2px;
	gap: 2px;
	border-radius: 8px;
	background: var(--ground);
	border: 1px solid var(--line);
}

.tabs button {
	height: 26px;
	padding: 0 10px;
	border-radius: 6px;
	border: 0;
	background: transparent;
	color: var(--muted);
	font-size: 12px;
}

.tabs button.on {
	background: var(--raised-hi);
	color: var(--text);
}
</style>
