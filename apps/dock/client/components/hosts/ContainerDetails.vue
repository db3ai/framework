<script setup lang="ts">
import { computed } from 'vue';

import type { ContainerSnapshot } from '../../../shared/hostContracts.js';
import { useDockContext } from '../../dock/context.js';
import { formatDuration } from '../../dock/presentation.js';
import { diskState, formatCount, formatDisk, formatDiskSize, formatPorts, formatRequests, responseShares } from '../../hosts/presentation.js';

/**
 * Everything known about one container: how traffic reaches it, a tunnel's edge
 * connections and ingress, a proxy's route table, and the container basics.
 * Names of other containers select them.
 */
const props = defineProps<{ container: ContainerSnapshot; containers: Map<string, ContainerSnapshot> }>();
const emit = defineEmits<{ select: [name: string] }>();

const { now } = useDockContext();
const tunnel = computed(() => props.container.tunnel);
const proxy = computed(() => props.container.proxy);
const ports = computed(() => formatPorts(props.container));
const declaredOnly = computed(() => {
	if (!props.container.listening) return [];
	const open = new Set(props.container.listening.map(item => item.port));
	return props.container.ports.filter(port => !open.has(port.port)).map(port => port.port);
});
const tunnelShares = computed(() => (tunnel.value?.responses ? responseShares(tunnel.value.responses) : []));
const proxyShares = computed(() => (props.container.requests ? responseShares(props.container.requests.byClass) : []));

function trafficOf(name: string): string {
	return props.containers.get(name)?.traffic ?? 'internal';
}

function ago(time: number | null): string {
	return time ? `${formatDuration(now.value - time)} ago` : '—';
}
</script>

<template>
	<div class="details">
		<section v-if="tunnel" class="block">
			<h3>Cloudflare Tunnel</h3>
			<div class="tiles">
				<div class="tile" :class="{ 'tile--bad': tunnel.connections !== null && tunnel.connections < 4 }">
					<span class="value">{{ tunnel.connections ?? '—' }}<small v-if="tunnel.connections !== null">/4</small></span>
					<span class="caption">edge connections</span>
				</div>
				<div class="tile">
					<span class="value">{{ tunnel.requestRate !== null ? formatRequests(tunnel.requestRate) : '…' }}</span>
					<span class="caption">requests now</span>
				</div>
				<div class="tile" :class="{ 'tile--bad': !!tunnel.errorRate }">
					<span class="value">{{ tunnel.errorRate !== null ? formatRequests(tunnel.errorRate).replace('req', 'err') : '…' }}</span>
					<span class="caption">failed to reach origin</span>
				</div>
				<div class="tile" :class="{ 'tile--warn': tunnel.reconnects > 96 }" title="Edge connections registered in the last 24 hours. A steady tunnel registers 4 when it starts.">
					<span class="value">{{ tunnel.reconnects }}</span>
					<span class="caption">reconnects in 24h</span>
				</div>
			</div>
			<div v-if="tunnel.totalRequests !== null" class="mix">
				<div class="mix-label">
					<span>{{ formatCount(tunnel.totalRequests) }} requests since start</span>
					<span v-if="tunnel.totalErrors" class="bad">{{ formatCount(tunnel.totalErrors) }} errors</span>
				</div>
				<div class="bar" role="img" :aria-label="tunnelShares.map(item => `${item.key} ${Math.round(item.share * 100)}%`).join(', ')">
					<span v-for="item in tunnelShares" :key="item.key" :class="`bar--${item.key}`" :style="{ flexGrow: item.share }" />
				</div>
				<div class="legend mono">
					<span v-for="item in tunnelShares" :key="item.key"><i :class="`bar--${item.key}`" />{{ item.key }} {{ formatCount(item.value) }}</span>
				</div>
			</div>
			<h4>Ingress <span v-if="tunnel.configVersion !== null" class="muted">config v{{ tunnel.configVersion }} · {{ ago(tunnel.configAt) }}</span></h4>
			<p v-if="!tunnel.ingress" class="muted">The connector's log has no configuration line; its rules live in the Cloudflare dashboard.</p>
			<table v-else class="table">
				<tbody>
					<tr v-for="(rule, index) in tunnel.ingress" :key="index">
						<td class="mono">{{ rule.hostname ?? (rule.service.startsWith('http_status') ? 'anything else' : '* (catch-all)') }}</td>
						<td class="mono muted">{{ rule.service }}</td>
						<td>
							<button v-for="target in rule.targets" :key="target" type="button" class="chip" :class="`chip--${trafficOf(target)}`" @click="emit('select', target)">{{ target }}</button>
							<span v-if="!rule.targets.length && rule.service.startsWith('http')" class="bad">no running container</span>
						</td>
					</tr>
				</tbody>
			</table>
			<p class="muted small mono">{{ tunnel.version ? `cloudflared ${tunnel.version}` : '' }}{{ tunnel.id ? ` · tunnel ${tunnel.id}` : '' }}</p>
		</section>

		<section v-if="proxy" class="block">
			<h3>Routing</h3>
			<div v-if="props.container.requests" class="mix">
				<div class="mix-label">
					<span>{{ formatRequests(props.container.requests.perSecond) }} from the access log</span>
					<span class="muted">health checks excluded</span>
				</div>
				<div v-if="props.container.requests.perSecond" class="bar">
					<span v-for="item in proxyShares" :key="item.key" :class="`bar--${item.key}`" :style="{ flexGrow: item.share }" />
				</div>
				<div v-if="props.container.requests.perSecond" class="legend mono">
					<span v-for="item in proxyShares" :key="item.key"><i :class="`bar--${item.key}`" />{{ item.key }} {{ formatRequests(item.value) }}</span>
				</div>
			</div>
			<template v-if="proxy.upstreams.length">
				<h4>Upstreams</h4>
				<table class="table">
					<tbody>
						<tr v-for="upstream in proxy.upstreams" :key="upstream.name">
							<td class="mono">{{ upstream.name }} <span v-if="upstream.role !== 'direct'" class="pill" :class="upstream.role === 'active' ? 'pill--ok' : 'pill--busy'">{{ upstream.role }}</span></td>
							<td class="mono muted">{{ upstream.servers.join(', ') }}</td>
							<td>
								<button v-for="target in upstream.targets" :key="target" type="button" class="chip" :class="`chip--${trafficOf(target)}`" @click="emit('select', target)">{{ target }}</button>
								<span v-if="!upstream.targets.length" class="bad">no running container</span>
							</td>
						</tr>
					</tbody>
				</table>
			</template>
			<template v-for="(server, index) in proxy.servers" :key="index">
				<h4>Listens on <span class="mono">{{ server.listen.join(', ') || '80' }}</span><span v-if="server.names.length && server.names.join() !== '_'" class="muted mono"> · {{ server.names.join(' ') }}</span></h4>
				<table class="table">
					<tbody>
						<tr v-for="location in server.locations" :key="location.path">
							<td class="mono">{{ location.path }}</td>
							<td class="mono muted">
								<template v-if="location.proxyPass">→ {{ location.proxyPass }}</template>
								<template v-else-if="location.returns">return {{ location.returns.replace(/\n/g, ' ') }}</template>
								<template v-else>served here</template>
								<span v-if="location.fallback" class="fallback"> · on error {{ location.fallback }}</span>
							</td>
							<td>
								<button v-for="target in location.targets" :key="target" type="button" class="chip" :class="`chip--${trafficOf(target)}`" @click="emit('select', target)">{{ target }}</button>
							</td>
						</tr>
					</tbody>
				</table>
			</template>
		</section>

		<section v-if="props.container.disks?.length" class="block">
			<h3>Storage</h3>
			<div v-for="disk in props.container.disks" :key="disk.filesystem + disk.size" class="disk" :class="`disk--${diskState(disk).tone}`">
				<div class="mix-label">
					<span class="mono">{{ disk.paths.join(', ') }}</span>
					<span class="usage">{{ Math.round(diskState(disk).share * 100) }}% · {{ formatDiskSize(disk.used) }} used · {{ formatDisk(disk) }}</span>
				</div>
				<div class="bar" role="img" :aria-label="`${Math.round(diskState(disk).share * 100)}% used`">
					<span class="disk-used" :style="{ flexGrow: diskState(disk).share }" />
					<span class="disk-free" :style="{ flexGrow: 1 - diskState(disk).share }" />
				</div>
				<p class="muted small mono">{{ disk.filesystem }}</p>
			</div>
		</section>

		<section class="block">
			<h3>Container</h3>
			<dl class="facts">
				<template v-if="props.container.routesIn.length">
					<dt>Receives from</dt>
					<dd>
						<span v-for="route in props.container.routesIn" :key="route.from + route.upstream" class="route">
							<button type="button" class="chip" :class="`chip--${trafficOf(route.from)}`" @click="emit('select', route.from)">{{ route.from }}</button>
							<span class="muted mono">{{ route.upstream === '*' ? 'catch-all' : route.upstream ? `via ${route.upstream}` : 'proxy_pass' }}<template v-if="route.role === 'previous'"> (previous)</template></span>
						</span>
					</dd>
				</template>
				<dt>Listening</dt>
				<dd class="mono">
					<template v-if="props.container.listening === null">{{ ports.labels.join(' ') || '—' }} <span class="muted">(declared; sockets not readable in this image)</span></template>
					<template v-else>{{ ports.labels.join(' ') || 'nothing' }}</template>
					<span v-if="declaredOnly.length" class="muted"> · declared but closed: {{ declaredOnly.map(port => `:${port}`).join(' ') }}</span>
				</dd>
				<dt>Image</dt>
				<dd class="mono">{{ props.container.image }}</dd>
				<dt>Command</dt>
				<dd class="mono">{{ props.container.command }}</dd>
				<template v-if="props.container.release">
					<dt>Release</dt>
					<dd class="mono">{{ props.container.release }}</dd>
				</template>
				<dt>Started</dt>
				<dd>{{ props.container.startedAt ? new Date(props.container.startedAt).toLocaleString() : '—' }}<span v-if="props.container.restartCount" class="bad"> · restarted {{ props.container.restartCount }}×</span><span class="muted"> · restart {{ props.container.restartPolicy || 'no' }}</span></dd>
				<template v-if="props.container.healthOutput">
					<dt>Health</dt>
					<dd class="mono bad">{{ props.container.healthOutput }}</dd>
				</template>
				<dt>Networks</dt>
				<dd>
					<div v-for="network in props.container.networks" :key="network.name" class="mono network">
						{{ network.name }}<span v-if="network.ip" class="muted">{{ ` ${network.ip}` }}</span>
						<span class="muted"> · {{ network.aliases.filter(alias => alias !== props.container.name && !/^[0-9a-f]{12}$/.test(alias)).join(', ') }}</span>
					</div>
				</dd>
			</dl>
		</section>
	</div>
</template>

<style scoped>
.details {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 14px 16px 20px;
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
	gap: 18px 28px;
	align-content: start;
	font-size: 13px;
}

.block {
	min-width: 0;
}

h3 {
	margin: 0 0 10px;
	font-size: 11px;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--muted);
	font-weight: 500;
}

h4 {
	margin: 14px 0 6px;
	font-size: 13px;
	font-weight: 600;
}

.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
	gap: 8px;
}

.tile {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 10px 12px;
	border-radius: 10px;
	border: 1px solid var(--line);
	background: var(--panel);
}

.tile--bad {
	border-color: color-mix(in srgb, var(--bad) 50%, transparent);
}

.tile--warn {
	border-color: color-mix(in srgb, var(--warn) 55%, transparent);
}

.value {
	font-size: 18px;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}

.value small {
	font-size: 12px;
	color: var(--muted);
	font-weight: 400;
}

.caption {
	font-size: 11.5px;
	color: var(--muted);
}

.mix {
	margin-top: 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.mix-label {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	font-size: 12px;
}

.bar {
	display: flex;
	height: 8px;
	border-radius: 4px;
	overflow: hidden;
	gap: 2px;
	background: var(--raised);
}

.bar > span {
	flex-basis: 0;
	min-width: 0;
}

.bar--2xx {
	background: var(--ok);
}

.bar--3xx {
	background: var(--kind-api);
}

.bar--4xx {
	background: var(--warn);
}

.bar--5xx {
	background: var(--bad);
}

.disk {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.disk + .disk {
	margin-top: 12px;
}

.disk p {
	margin: 0;
}

.usage {
	color: var(--muted);
	white-space: nowrap;
}

.disk-used {
	background: var(--ok);
}

.disk--warn .disk-used {
	background: var(--warn);
}

.disk--bad .disk-used {
	background: var(--bad);
}

.disk--warn .usage {
	color: var(--warn);
}

.disk--bad .usage {
	color: var(--bad);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	font-size: 11.5px;
	color: var(--muted);
}

.legend i {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 2px;
	margin-right: 5px;
}

.table {
	width: 100%;
	border-collapse: collapse;
	font-size: 12.5px;
}

.table td {
	padding: 6px 8px 6px 0;
	border-top: 1px solid var(--line-soft);
	vertical-align: top;
	overflow-wrap: anywhere;
}

.table td:first-child {
	white-space: nowrap;
}

.facts {
	margin: 0;
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 6px 14px;
}

dt {
	color: var(--muted);
}

dd {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}

.route {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin: 0 12px 4px 0;
}

.network {
	font-size: 12px;
}

.chip {
	font: inherit;
	font-family: var(--mono);
	font-size: 11.5px;
	border-radius: 999px;
	padding: 1px 8px;
	margin: 0 4px 3px 0;
	border: 1px solid var(--line-strong);
	background: transparent;
	color: var(--text-2);
}

.chip--live {
	border-color: color-mix(in srgb, var(--ok) 50%, transparent);
	color: var(--ok);
}

.chip--standby {
	border-color: color-mix(in srgb, var(--warn) 50%, transparent);
	color: var(--warn);
}

.pill {
	font-family: var(--sans);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	border-radius: 999px;
	padding: 1px 6px;
	margin-left: 4px;
}

.pill--ok {
	color: var(--ok);
	background: color-mix(in srgb, var(--ok) 14%, transparent);
}

.pill--busy {
	color: var(--warn);
	background: color-mix(in srgb, var(--warn) 14%, transparent);
}

.fallback {
	color: var(--warn);
}

.muted {
	color: var(--muted);
	font-weight: 400;
}

.small {
	font-size: 11.5px;
	margin: 10px 0 0;
}

.bad {
	color: var(--bad);
}
</style>
