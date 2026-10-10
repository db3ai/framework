<script setup lang="ts">
import type { ProjectNavItem } from '../dock/projectNav.js';
import { KIND_ORDER, kindMeta } from '../dock/presentation.js';
import KindTile from './KindTile.vue';
import ProjectBadge from './ProjectBadge.vue';

/** Project navigation; collapses to a rail of badges. */
const props = defineProps<{ items: ProjectNavItem[]; current: string; collapsed: boolean }>();
const emit = defineEmits<{ pick: [id: string] }>();
</script>

<template>
	<nav class="sidebar" :class="{ 'sidebar--collapsed': props.collapsed }" aria-label="Projects">
		<div class="group">
			<div v-if="!props.collapsed" class="eyebrow heading">Projects</div>
			<button
				v-for="item in props.items"
				:key="item.id"
				type="button"
				class="item"
				:class="{ 'item--current': item.id === props.current }"
				:aria-current="item.id === props.current ? 'true' : undefined"
				:aria-label="`${item.label}, ${item.running} of ${item.total} running`"
				:title="props.collapsed ? item.label : undefined"
				@click="emit('pick', item.id)"
			>
				<ProjectBadge :initials="item.initials" :health="item.health" />
				<template v-if="!props.collapsed">
					<span class="label">{{ item.label }}</span>
					<span class="count mono">{{ item.running }}/{{ item.total }}</span>
				</template>
			</button>
		</div>
		<div v-if="!props.collapsed" class="legend">
			<div class="eyebrow">Process types</div>
			<div v-for="kind in KIND_ORDER" :key="kind" class="legend-item">
				<KindTile :kind="kind" size="sm" />
				{{ kindMeta(kind).label }}
			</div>
		</div>
		<p v-if="!props.collapsed" class="foot">Runs each project's <span class="mono">npm run</span> scripts in its own folder.</p>
	</nav>
</template>

<style scoped>
.sidebar {
	width: 240px;
	flex: none;
	padding: 16px 10px;
	border-right: 1px solid var(--line);
	background: var(--rail);
	display: flex;
	flex-direction: column;
	gap: 22px;
	overflow-y: auto;
}

.sidebar--collapsed {
	width: 64px;
	padding: 16px 8px;
}

.group {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.heading {
	padding: 0 10px 8px;
}

.item {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	height: 42px;
	padding: 0 8px;
	border-radius: 8px;
	border: 0;
	background: transparent;
	font-size: 13px;
	text-align: left;
}

.sidebar--collapsed .item {
	justify-content: center;
	padding: 0;
}

.item:hover {
	background: var(--raised);
}

.item--current {
	background: var(--raised-hi);
}

.label {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.count {
	font-size: 12px;
	color: var(--muted);
}

.legend {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 0 10px;
}

.legend-item {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 13px;
}

.foot {
	margin: auto 0 0;
	padding: 12px 10px 0;
	border-top: 1px solid var(--line);
	font-size: 12px;
	line-height: 1.5;
	color: var(--muted);
}

@media (max-width: 720px) {
	.sidebar:not(.sidebar--collapsed) {
		width: 100%;
		border-right: 0;
		border-bottom: 1px solid var(--line);
	}
}
</style>
