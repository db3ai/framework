<script setup lang="ts">
import { computed, reactive } from 'vue';

import type { AppGroup, ContainerSnapshot, SlotGroup } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { isRunning, matchesFilter, SLOT_STATE, slotName } from '../../hosts/presentation.js';
import ContainerRow from './ContainerRow.vue';

/**
 * One app on a server: its routing, its blue/green or release slots, its
 * databases and anything else, each as a section of container rows.
 */
const props = defineProps<{ app: AppGroup; containers: Map<string, ContainerSnapshot>; hostId: string; hostName: string; filter: string }>();

const { layout } = useDockContext();

/** Slots whose stopped containers are shown; others list only what runs. */
const expanded = reactive(new Set<string>());

const pick = (names: string[]) => names.map(name => props.containers.get(name)).filter((item): item is ContainerSnapshot => !!item && matchesFilter(item, props.filter));

const sections = computed(() => [
	{ id: 'routing', title: 'Routing', hint: 'Gateways and tunnels that stay up across releases.', items: pick(props.app.routing) },
	{ id: 'data', title: 'Data', hint: 'Databases shared by every slot.', items: pick(props.app.databases) },
	{ id: 'services', title: props.app.slots.length ? 'Other services' : 'Containers', hint: '', items: pick(props.app.services) },
].filter(section => section.items.length));

const slots = computed(() => props.app.slots.map(slot => {
	const all = pick(slot.containers);
	const running = all.filter(isRunning);
	const stopped = all.length - running.length;
	// Stopped slots and the stopped part of a standby slot fold away until asked for.
	const showAll = expanded.has(slot.id) || slot.state === 'live' || !running.length && stopped <= 2 || props.filter.trim() !== '';
	return { slot, items: showAll ? all : running, running: running.length, total: all.length, hidden: showAll ? 0 : stopped };
}).filter(entry => entry.total));

const liveSlot = computed(() => props.app.slots.find(slot => slot.state === 'live'));
const counts = computed(() => {
	const all = [...props.app.routing, ...props.app.databases, ...props.app.services, ...props.app.slots.flatMap(slot => slot.containers)].map(name => props.containers.get(name)).filter(Boolean) as ContainerSnapshot[];
	return { running: all.filter(isRunning).length, total: all.length };
});

/** Services with more than one container show replica numbers. */
const replicated = computed(() => {
	const seen = new Map<string, number>();
	for (const container of props.containers.values()) {
		if (container.app !== props.app.id || !container.service) continue;
		const key = `${container.project}/${container.service}`;
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}
	return (container: ContainerSnapshot) => (seen.get(`${container.project}/${container.service}`) ?? 0) > 1;
});

const selectedKey = computed(() => layout.selectedContainer);
const keyOf = (container: ContainerSnapshot) => `${props.hostId}/${container.name}`;

function toggle(slot: SlotGroup): void {
	if (expanded.has(slot.id)) expanded.delete(slot.id);
	else expanded.add(slot.id);
}
</script>

<template>
	<section class="card" :aria-labelledby="`app-${props.app.id}`">
		<div class="card-head">
			<div class="title">
				<h2 :id="`app-${props.app.id}`">{{ props.app.name }}</h2>
				<span class="projects mono">{{ props.app.projects.join(' · ') }}</span>
			</div>
			<span v-if="liveSlot" class="live" :title="liveSlot.release ? `Release ${liveSlot.release}` : undefined">
				<span class="dot dot--ok" /> Live: <strong>{{ slotName(liveSlot.label) }}</strong>
			</span>
			<span class="count mono">{{ counts.running }}/{{ counts.total }} running</span>
		</div>

		<template v-for="section in sections.filter(item => item.id === 'routing')" :key="section.id">
			<div class="section-head"><span class="eyebrow">{{ section.title }}</span><span class="hint">{{ section.hint }}</span></div>
			<ContainerRow
				v-for="container in section.items"
				:key="container.id"
				:container="container"
				:host-id="props.hostId"
				:host-name="props.hostName"
				:replicated="replicated(container)"
				:selected="selectedKey === keyOf(container)"
				@select="layout.selectedContainer = keyOf(container)"
			/>
		</template>

		<template v-for="entry in slots" :key="entry.slot.id">
			<div class="section-head slot-head" :class="`slot-head--${entry.slot.state}`">
				<span class="slot-name" :class="`slot-name--${entry.slot.label}`">{{ slotName(entry.slot.label) }}</span>
				<span class="slot-state" :class="`tone--${SLOT_STATE[entry.slot.state].tone}`" :title="SLOT_STATE[entry.slot.state].hint">{{ SLOT_STATE[entry.slot.state].label }}</span>
				<span v-if="entry.slot.release && entry.slot.release !== entry.slot.label" class="hint mono" title="Release">{{ entry.slot.release }}</span>
				<span class="hint mono slot-count">{{ entry.running }}/{{ entry.total }} running</span>
			</div>
			<ContainerRow
				v-for="container in entry.items"
				:key="container.id"
				:container="container"
				:host-id="props.hostId"
				:host-name="props.hostName"
				:replicated="replicated(container)"
				:selected="selectedKey === keyOf(container)"
				@select="layout.selectedContainer = keyOf(container)"
			/>
			<button v-if="entry.hidden || expanded.has(entry.slot.id)" type="button" class="fold" @click="toggle(entry.slot)">
				{{ expanded.has(entry.slot.id) ? 'Hide stopped containers' : `Show ${entry.hidden} stopped container${entry.hidden === 1 ? '' : 's'}` }}
			</button>
		</template>

		<template v-for="section in sections.filter(item => item.id !== 'routing')" :key="section.id">
			<div class="section-head"><span class="eyebrow">{{ section.title }}</span><span v-if="section.hint" class="hint">{{ section.hint }}</span></div>
			<ContainerRow
				v-for="container in section.items"
				:key="container.id"
				:container="container"
				:host-id="props.hostId"
				:host-name="props.hostName"
				:replicated="replicated(container)"
				:selected="selectedKey === keyOf(container)"
				@select="layout.selectedContainer = keyOf(container)"
			/>
		</template>
	</section>
</template>

<style scoped>
.card {
	border: 1px solid var(--line);
	border-radius: 12px;
	background: var(--panel);
	overflow: hidden;
	flex: none;
}

.card-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 16px;
	padding: 12px 16px;
}

.title {
	display: flex;
	align-items: baseline;
	gap: 10px;
	flex: 1 1 240px;
	min-width: 0;
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.projects {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.live {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	font-size: 13px;
	color: var(--text-2);
}

.count {
	font-size: 12px;
	color: var(--muted);
}

.section-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 10px;
	padding: 8px 16px;
	border-top: 1px solid var(--line-soft);
	background: var(--rail);
}

.hint {
	font-size: 12px;
	color: var(--muted);
}

.slot-head {
	box-shadow: inset 3px 0 0 var(--faint);
}

.slot-head--live {
	box-shadow: inset 3px 0 0 var(--ok);
}

.slot-head--standby {
	box-shadow: inset 3px 0 0 var(--warn);
}

.slot-name {
	font-weight: 600;
	font-size: 13px;
}

.slot-name--blue {
	color: var(--kind-api);
}

.slot-name--green {
	color: var(--ok);
}

.slot-state {
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.tone--ok {
	color: var(--ok);
}

.tone--busy {
	color: var(--warn);
}

.slot-count {
	margin-left: auto;
}

.fold {
	display: block;
	width: 100%;
	padding: 8px 16px 8px 62px;
	border: 0;
	border-top: 1px solid var(--line-soft);
	background: transparent;
	color: var(--link);
	font-size: 12px;
	text-align: left;
}

.fold:hover {
	background: var(--raised);
}
</style>
