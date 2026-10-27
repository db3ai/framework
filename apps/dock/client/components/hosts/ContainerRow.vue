<script setup lang="ts">
import { computed } from 'vue';

import type { ContainerAction, ContainerSnapshot } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { confirmAction, containerDetail, containerLabel, containerStatus, formatContainerUsage, formatPorts, formatRate, isRunning, requestSummary, roleMeta, trafficOf } from '../../hosts/presentation.js';
import Icon from '../Icon.vue';
import UsageSparks from '../UsageSparks.vue';
import RoleTile from './RoleTile.vue';

/** One container on a server. Selecting it shows its logs below the list. */
const props = defineProps<{ container: ContainerSnapshot; hostId: string; hostName: string; replicated: boolean; selected: boolean }>();
const emit = defineEmits<{ select: [] }>();

const { dock, now } = useDockContext();
const status = computed(() => containerStatus(props.container, now.value));
const running = computed(() => isRunning(props.container));
const traffic = computed(() => trafficOf(props.container));
const ports = computed(() => formatPorts(props.container));
const requests = computed(() => requestSummary(props.container));
const label = computed(() => containerLabel(props.container, props.replicated));
const busy = computed(() => props.container.pending !== null);

function run(action: ContainerAction): void {
	const question = confirmAction(props.container, action, props.hostName);
	if (question && !window.confirm(question)) return;
	void dock.containerAction(props.hostId, props.container.name, action);
}
</script>

<template>
	<div class="row" :class="{ 'row--selected': props.selected, 'row--off': !running }">
		<button type="button" class="who" :aria-label="`Show logs for ${props.container.name}`" :aria-pressed="props.selected" :title="props.container.command" @click="emit('select')">
			<RoleTile :role="props.container.role" :dimmed="!running" />
			<span class="names">
				<span class="name">{{ label }}</span>
				<span class="detail mono"><span class="role">{{ roleMeta(props.container.role).label }}</span> · {{ containerDetail(props.container) }}</span>
			</span>
		</button>
		<div class="status" :title="props.container.healthOutput ?? props.container.status">
			<span class="dot" :class="`dot--${status.tone}`" />
			<span :class="`tone--${status.tone}`">{{ status.label }}</span>
		</div>
		<div class="traffic">
			<span class="line">
				<span v-if="traffic.badge" class="pill" :class="`pill--${traffic.tone}`">{{ traffic.badge }}</span>
				<span v-if="traffic.via" class="via mono" :title="props.container.routesIn.map(route => `${route.from} → ${route.upstream ?? 'proxy_pass'} (${route.role})`).join('\n') || undefined">{{ traffic.via }}</span>
			</span>
			<span v-if="requests || ports.labels.length" class="ports mono">
				<span v-if="requests" class="requests" title="Requests seen recently (health checks excluded)">{{ requests }}</span>
				<span v-if="requests && ports.labels.length"> · </span>
				<span v-if="ports.labels.length" :class="{ declared: ports.declared }" :title="ports.declared ? 'Declared by the image; could not check what listens' : 'Listening now'">{{ ports.labels.join(' ') }}</span>
			</span>
		</div>
		<div class="usage mono">
			<UsageSparks v-if="running && props.container.cpu !== null" :history="props.container.history" :cpu="props.container.cpu" :memory="props.container.memory" :name="props.container.name" />
			<span v-else>{{ formatContainerUsage(props.container) }}</span>
			<span v-if="running && (props.container.rxRate !== null || props.container.pids !== null)" class="sub" :title="`Network in / out${props.container.pids !== null ? ` · ${props.container.pids} processes` : ''}`">
				↓{{ formatRate(props.container.rxRate) }} ↑{{ formatRate(props.container.txRate) }}<template v-if="props.container.pids !== null"> · {{ props.container.pids }}p</template>
			</span>
		</div>
		<div class="actions">
			<button type="button" class="icon-btn" :disabled="busy" :aria-label="`Restart ${props.container.name}`" title="Restart" @click="run('restart')"><Icon name="restart" :size="15" /></button>
			<button
				type="button"
				class="icon-btn"
				:disabled="busy"
				:aria-label="`${running ? 'Stop' : 'Start'} ${props.container.name}`"
				:title="running ? 'Stop' : 'Start'"
				@click="run(running ? 'stop' : 'start')"
			><Icon :name="running ? 'stop' : 'play'" :size="14" /></button>
		</div>
		<p v-if="props.container.healthOutput && props.container.health === 'unhealthy'" class="health mono">Health check: {{ props.container.healthOutput }}</p>
	</div>
</template>

<style scoped>
.row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 20px;
	padding: 9px 16px;
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

.row--off .name {
	color: var(--muted);
}

.detail {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.status {
	width: 170px;
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 13px;
}

.traffic {
	width: 220px;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
	font-size: 12px;
}

.line {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.pill {
	flex: none;
	font-size: 10.5px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	border-radius: 999px;
	padding: 1px 7px;
}

.pill--ok {
	color: var(--ok);
	background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill--busy {
	color: var(--warn);
	background: color-mix(in srgb, var(--warn) 14%, transparent);
}

.via,
.ports {
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.ports {
	color: var(--faint);
}

.requests {
	color: var(--text-2);
}

.declared {
	font-style: italic;
}

.usage {
	width: 150px;
	font-size: 12px;
	color: var(--muted);
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.sub {
	color: var(--faint);
	font-size: 11px;
	white-space: nowrap;
}

.actions {
	display: flex;
	gap: 4px;
}

.health {
	flex-basis: 100%;
	margin: 0 0 0 46px;
	font-size: 11.5px;
	color: var(--bad);
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
