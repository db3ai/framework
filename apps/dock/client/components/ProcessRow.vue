<script setup lang="ts">
import { computed } from 'vue';

import type { ProcessDefinition } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import { formatUsage, isUp, statusOf } from '../dock/presentation.js';
import Icon from './Icon.vue';
import KindTile from './KindTile.vue';

/** One process in the list view. Selecting it shows its output below the list. */
const props = defineProps<{ process: ProcessDefinition; projectName: string; selected: boolean }>();
const emit = defineEmits<{ select: [] }>();

const { dock, now } = useDockContext();
const snapshot = computed(() => dock.snapshots.get(props.process.id));
const status = computed(() => statusOf(snapshot.value, now.value));
const up = computed(() => isUp(snapshot.value));
const fullName = computed(() => `${props.projectName} · ${props.process.name}`);
const link = computed(() => (snapshot.value?.port ? dock.linkFor(snapshot.value.port) : null));
const otherPorts = computed(() => (snapshot.value?.ports ?? []).filter(port => port !== snapshot.value?.port));

function remove(): void {
	const note = props.process.saved ? ' It will also be removed from the saved project.' : '';
	if (window.confirm(`Remove ${fullName.value}?${note}`)) void dock.remove(props.process.id);
}
</script>

<template>
	<div class="row" :class="{ 'row--selected': props.selected }">
		<button type="button" class="who" :aria-label="`Show output for ${fullName}`" :aria-pressed="props.selected" @click="emit('select')">
			<KindTile :kind="props.process.kind" :dimmed="!up" />
			<span class="names">
				<span class="name">
					{{ props.process.name }}
					<span v-if="snapshot?.external" class="tag tag--external" title="Started in a terminal or editor. Restart to run it inside Dock with live output.">outside Dock</span>
					<span v-else-if="!props.process.saved" class="tag">this session</span>
				</span>
				<span class="cmd mono">{{ snapshot?.command }}</span>
			</span>
		</button>
		<div class="status">
			<span class="dot" :class="`dot--${status.tone}`" />
			<span :class="`tone--${status.tone}`">{{ status.label }}</span>
		</div>
		<div class="port mono">
			<a v-if="link" :href="link.href" :title="link.title" target="_blank" rel="noopener"><span class="link-label">{{ link.label }}</span> <Icon name="external" :size="11" /></a>
			<span v-if="otherPorts.length" class="more" :title="`Also listening on ${otherPorts.map(port => `:${port}`).join(', ')}`">+{{ otherPorts.length }}</span>
			<span v-if="!link" class="faint">—</span>
		</div>
		<div class="usage mono">{{ formatUsage(snapshot) }}</div>
		<div class="actions">
			<button type="button" class="icon-btn" :aria-label="`Restart ${fullName}${snapshot?.external ? ' inside Dock' : ''}`" :title="snapshot?.external ? 'Restart inside Dock' : 'Restart'" @click="dock.restart(props.process.id)"><Icon name="restart" :size="15" /></button>
			<button
				type="button"
				class="icon-btn"
				:aria-label="`${up ? 'Stop' : 'Start'} ${fullName}`"
				:title="up ? 'Stop' : 'Start'"
				@click="up ? dock.stop(props.process.id) : dock.start(props.process.id)"
			><Icon :name="up ? 'stop' : 'play'" :size="14" /></button>
			<button v-if="!snapshot?.external" type="button" class="icon-btn" :aria-label="`Remove ${fullName}`" title="Remove" @click="remove"><Icon name="trash" :size="15" /></button>
		</div>
	</div>
</template>

<style scoped>
.row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px 20px;
	padding: 10px 16px;
	border-top: 1px solid var(--line-soft);
}

.row--selected {
	background: var(--raised);
	box-shadow: inset 2px 0 0 var(--link);
}

.who {
	display: flex;
	align-items: center;
	gap: 12px;
	flex: 1 1 260px;
	min-width: 0;
	background: transparent;
	border: 0;
	padding: 0;
	text-align: left;
}

.names {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.name {
	font-weight: 500;
}

.tag {
	margin-left: 8px;
	font-size: 11px;
	color: var(--muted);
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	padding: 1px 7px;
	font-weight: 400;
}

.tag--external {
	color: var(--warn);
	border-color: color-mix(in srgb, var(--warn) 45%, transparent);
}

.cmd {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.status {
	width: 150px;
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
}

.port {
	width: 190px;
	font-size: 12px;
	min-width: 0;
}

.more {
	margin-left: 6px;
	color: var(--muted);
	cursor: default;
}

.link-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.port a {
	text-decoration: none;
	max-width: 100%;
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.usage {
	width: 130px;
	font-size: 12px;
	color: var(--muted);
}

.faint {
	color: var(--faint);
}

.actions {
	display: flex;
	gap: 4px;
}
</style>
