<script setup lang="ts">
import { computed, ref } from 'vue';

import type { HostSnapshot } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { formatCores, formatDuration, formatMemory } from '../../dock/presentation.js';
import { diskState, formatDisk, formatDiskSize, hostWarnings, isRunning, matchesFilter } from '../../hosts/presentation.js';
import { clampSize } from '../../dock/splitSizes.js';
import Icon from '../Icon.vue';
import SplitHandle from '../SplitHandle.vue';
import AppCard from './AppCard.vue';
import ContainerPanel from './ContainerPanel.vue';
import RoutesView from '../routes/RoutesView.vue';

/**
 * A Docker host: what runs, how traffic reaches it and what changed, one card
 * per app, with the selected container's logs docked below.
 */
const props = defineProps<{ host: HostSnapshot; filter: string }>();

const { dock, layout, now } = useDockContext();
const root = ref<HTMLElement | null>(null);
const showAllActivity = ref(false);
let dragStart = 0;

const containers = computed(() => new Map(props.host.containers.map(container => [container.name, container])));
const apps = computed(() => props.host.apps.filter(app => {
	const names = [...app.routing, ...app.databases, ...app.services, ...app.slots.flatMap(slot => slot.containers)];
	return names.some(name => {
		const container = containers.value.get(name);
		return container && (matchesFilter(container, props.filter) || app.name.toLowerCase().includes(props.filter.trim().toLowerCase()));
	});
}));
const warnings = computed(() => hostWarnings(props.host));
const running = computed(() => props.host.containers.filter(isRunning));
const totals = computed(() => ({
	cpu: running.value.reduce((sum, container) => sum + (container.cpu ?? 0), 0),
	memory: running.value.reduce((sum, container) => sum + (container.memory ?? 0), 0),
}));
const activity = computed(() => props.host.activity.slice(0, showAllActivity.value ? 60 : 6));

const selected = computed(() => {
	const key = layout.selectedContainer;
	if (!key?.startsWith(`${props.host.id}/`)) return null;
	return containers.value.get(key.slice(props.host.id.length + 1)) ?? null;
});

const PANEL_MIN = 120;
const CARDS_MIN = 140;

function resizePanel(delta: number): void {
	const available = root.value?.clientHeight ?? 800;
	layout.panelHeight = clampSize(dragStart - delta, PANEL_MIN, available - CARDS_MIN);
}

function select(name: string): void {
	layout.selectedContainer = `${props.host.id}/${name}`;
}

function removeHost(): void {
	if (window.confirm(`Remove ${props.host.name} from Dock? Nothing on the server changes.`)) void dock.removeHost(props.host.id);
}

function clock(time: number): string {
	return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function actionTone(action: string, exitCode: number | null): string {
	if (action === 'die' && exitCode) return 'bad';
	if (action === 'oom' || action.endsWith('unhealthy')) return 'bad';
	if (action === 'start' || action.endsWith(': healthy')) return 'ok';
	return 'off';
}
</script>

<template>
	<div ref="root" class="host-view">
		<div class="cards">
			<section class="summary" aria-label="Server status">
				<div class="facts">
					<span class="fact">
						<span class="dot" :class="props.host.status === 'online' ? 'dot--ok' : props.host.status === 'error' ? 'dot--bad' : 'dot--busy'" />
						<strong>{{ props.host.status === 'online' ? 'Connected' : props.host.status === 'error' ? 'Unreachable' : 'Connecting…' }}</strong>
						<span class="muted mono">{{ props.host.target }}</span>
					</span>
					<span v-if="props.host.engine" class="fact muted">{{ props.host.engine.os }} · Docker {{ props.host.engine.version }} · {{ formatCores(props.host.engine.cpus) }} · {{ formatMemory(props.host.engine.memory) }}</span>
					<span v-if="props.host.kubernetes && !props.host.kubernetes.error" class="fact muted" title="Pods in the k3s cluster on this machine are listed with the containers">
						Kubernetes {{ props.host.kubernetes.version }}<template v-if="props.host.kubernetes.nodes"> · {{ props.host.kubernetes.nodes }} node{{ props.host.kubernetes.nodes === 1 ? '' : 's' }}<template v-if="!props.host.engine"> · {{ formatCores(props.host.kubernetes.cpus) }} · {{ formatMemory(props.host.kubernetes.memory) }}</template></template>
					</span>
					<span
						v-for="disk in props.host.disks ?? []"
						:key="disk.filesystem + disk.size"
						class="fact disk"
						:class="`disk--${diskState(disk).tone}`"
						:title="`${disk.filesystem} on ${disk.paths.join(', ')}: ${formatDiskSize(disk.used)} used, ${formatDisk(disk)}`"
					>
						<span class="meter" role="img" :aria-label="`${Math.round(diskState(disk).share * 100)}% used`"><span :style="{ width: `${diskState(disk).share * 100}%` }" /></span>
						<span class="mono">{{ disk.paths[0] }}</span>
						<span class="muted">{{ formatDiskSize(disk.used) }} used · {{ formatDisk(disk) }}</span>
					</span>
					<span class="fact muted mono">{{ running.length }}/{{ props.host.containers.length }} running · {{ totals.cpu.toFixed(0) }}% CPU · {{ formatMemory(totals.memory) }}</span>
					<span v-if="props.host.sampledAt" class="fact faint">updated {{ formatDuration(now - props.host.sampledAt) }} ago<template v-if="props.host.latencyMs"> · {{ props.host.latencyMs }} ms</template></span>
				</div>
				<div class="summary-actions">
					<div class="segmented" role="group" aria-label="Server view">
						<button type="button" :aria-pressed="layout.serverView === 'list'" :class="{ on: layout.serverView === 'list' }" @click="layout.serverView = 'list'"><Icon name="list" :size="13" /> List</button>
						<button type="button" :aria-pressed="layout.serverView === 'routes'" :class="{ on: layout.serverView === 'routes' }" @click="layout.serverView = 'routes'"><Icon name="route" :size="13" /> Routes</button>
					</div>
					<button type="button" class="btn" title="Sample now" @click="dock.refreshHost(props.host.id)"><Icon name="restart" :size="13" /> Refresh</button>
					<button type="button" class="icon-btn icon-btn--ghost" :aria-label="`Remove ${props.host.name}`" title="Remove server" @click="removeHost"><Icon name="trash" :size="14" /></button>
				</div>
				<p v-if="props.host.error" class="error mono" role="alert">{{ props.host.error }}</p>
				<p v-if="props.host.kubernetes?.error" class="error mono" role="alert">{{ props.host.kubernetes.error }}</p>
			</section>

			<section v-if="warnings.length" class="attention" aria-label="Needs attention">
				<div class="eyebrow"><Icon name="alert" :size="12" /> Needs attention</div>
				<template v-for="warning in warnings" :key="`${warning.container}${warning.message}`">
					<button v-if="warning.container" type="button" class="warning" @click="select(warning.container)">
						<span class="mono">{{ warning.container }}</span> {{ warning.message }}
					</button>
					<p v-else class="warning">{{ warning.message }}</p>
				</template>
			</section>

			<RoutesView v-if="layout.serverView === 'routes'" :host="props.host" :filter="props.filter" />
			<template v-else>
				<p v-if="props.host.status === 'online' && !props.host.containers.length" class="none">No containers on this server.</p>
				<p v-else-if="props.filter && !apps.length" class="none">No containers match “{{ props.filter }}”.</p>

				<AppCard
					v-for="app in apps"
					:key="app.id"
					:app="app"
					:containers="containers"
					:host-id="props.host.id"
					:host-name="props.host.name"
					:filter="props.filter"
				/>

				<section v-if="props.host.activity.length" class="activity" aria-label="Recent activity">
					<div class="activity-head">
						<span class="eyebrow">Activity</span>
						<span class="hint">Container changes from any source: deploys, restart policies, Dock.</span>
					</div>
					<ol class="events">
						<li v-for="event in activity" :key="`${event.time}-${event.container}-${event.action}`" class="event">
							<span class="time mono">{{ clock(event.time) }}</span>
							<span class="dot" :class="`dot--${actionTone(event.action, event.exitCode)}`" />
							<button type="button" class="link mono" @click="select(event.container)">{{ event.container }}</button>
							<span class="action">{{ event.action }}<template v-if="event.action === 'die' && event.exitCode !== null"> ({{ event.exitCode }})</template></span>
						</li>
					</ol>
					<button v-if="props.host.activity.length > 6" type="button" class="fold" @click="showAllActivity = !showAllActivity">{{ showAllActivity ? 'Show less' : `Show ${Math.min(props.host.activity.length, 60) - 6} more` }}</button>
				</section>
			</template>
		</div>
		<SplitHandle
			v-if="selected"
			orientation="horizontal"
			label="Resize details panel"
			:value="layout.panelHeight"
			@start="dragStart = layout.panelHeight"
			@move="resizePanel"
			@reset="layout.panelHeight = 280"
		/>
		<div v-if="selected" class="dock-panel" :style="{ height: `${layout.panelHeight}px` }">
			<ContainerPanel :container="selected" :host-id="props.host.id" :containers="containers" @select="select" @close="layout.selectedContainer = null" />
		</div>
	</div>
</template>

<style scoped>
.host-view {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.cards {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 20px;
	display: flex;
	flex-direction: column;
	gap: 16px;
}

.summary {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px 16px;
	flex: none;
}

.facts {
	flex: 1 1 400px;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 18px;
	font-size: 13px;
}

.fact {
	display: inline-flex;
	align-items: center;
	gap: 8px;
}

.muted {
	color: var(--muted);
}

.faint {
	color: var(--faint);
	font-size: 12px;
}

.summary-actions {
	display: flex;
	align-items: center;
	gap: 6px;
}

.segmented {
	display: flex;
	padding: 2px;
	gap: 2px;
	border-radius: 8px;
	background: var(--ground);
	border: 1px solid var(--line);
}

.segmented button {
	height: 28px;
	padding: 0 10px;
	border-radius: 6px;
	border: 0;
	background: transparent;
	color: var(--muted);
	font-size: 12px;
	display: flex;
	align-items: center;
	gap: 6px;
}

.segmented button.on {
	background: var(--raised-hi);
	color: var(--text);
}

.error {
	flex-basis: 100%;
	margin: 0;
	padding: 10px 12px;
	border-radius: 8px;
	background: color-mix(in srgb, var(--bad) 10%, transparent);
	color: var(--bad);
	font-size: 12px;
	white-space: pre-wrap;
}

.attention {
	flex: none;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 12px 14px;
	border-radius: 12px;
	border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
	background: color-mix(in srgb, var(--warn) 7%, transparent);
}

.attention .eyebrow {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--warn);
	margin-bottom: 4px;
}

.warning {
	text-align: left;
	border: 0;
	background: transparent;
	padding: 2px 0;
	font-size: 13px;
	color: var(--text-2);
}

p.warning {
	margin: 0;
}

.disk--warn .mono,
.disk--warn .muted {
	color: var(--warn);
}

.disk--bad .mono,
.disk--bad .muted {
	color: var(--bad);
}

.meter {
	width: 44px;
	height: 6px;
	border-radius: 3px;
	background: var(--line);
	overflow: hidden;
}

.meter > span {
	display: block;
	height: 100%;
	background: var(--muted);
}

.disk--warn .meter > span {
	background: var(--warn);
}

.disk--bad .meter > span {
	background: var(--bad);
}

.warning:hover .mono {
	text-decoration: underline;
}

.none {
	margin: 4px 0;
	color: var(--muted);
}

.activity {
	flex: none;
	border: 1px solid var(--line);
	border-radius: 12px;
	background: var(--panel);
	overflow: hidden;
}

.activity-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 6px 12px;
	padding: 12px 16px 8px;
}

.hint {
	font-size: 12px;
	color: var(--muted);
}

.events {
	list-style: none;
	margin: 0;
	padding: 0 16px 10px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.event {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 12.5px;
	min-width: 0;
}

.time {
	color: var(--faint);
	font-size: 12px;
}

.link {
	border: 0;
	background: transparent;
	padding: 0;
	color: var(--link);
	font-size: 12px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.action {
	color: var(--muted);
	white-space: nowrap;
}

.fold {
	display: block;
	width: 100%;
	padding: 8px 16px;
	border: 0;
	border-top: 1px solid var(--line-soft);
	background: transparent;
	color: var(--link);
	font-size: 12px;
	text-align: left;
}

.dock-panel {
	flex: none;
	min-height: 0;
	max-height: calc(100% - 140px);
	display: flex;
	flex-direction: column;
}

.dock-panel > * {
	flex: 1;
}
</style>
