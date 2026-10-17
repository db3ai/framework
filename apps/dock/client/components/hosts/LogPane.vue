<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';

import type { OutputChunk } from '../../../shared/contracts.js';
import type { ContainerSnapshot } from '../../../shared/hostContracts.js';
import { dockApi } from '../../api.js';
import { useXterm } from '../../terminal/useXterm.js';
import Icon from '../Icon.vue';

/**
 * Follows one container's logs (`docker logs -f`) in a read-only terminal. The
 * stream lives as long as the pane; it can be reconnected after it ends.
 */
const props = defineProps<{ container: ContainerSnapshot; hostId: string }>();

const chunks = shallowRef<OutputChunk[]>([]);
const streaming = ref(false);
const host = ref<HTMLElement | null>(null);
const MAX_CHUNKS = 4000;
let source: EventSource | null = null;
let seq = 0;

function connect(): void {
	source?.close();
	chunks.value = [];
	seq = 0;
	streaming.value = true;
	source = new EventSource(dockApi.logsUrl(props.hostId, props.container.name));
	source.onmessage = message => {
		const payload = JSON.parse(message.data) as { data?: string; end?: string };
		if (payload.data !== undefined) append(payload.data);
		if (payload.end !== undefined) {
			append(`\r\n\x1b[2m— ${payload.end} —\x1b[0m\r\n`);
			stop();
		}
	};
	// Not found, or the server went away: EventSource would retry forever.
	source.onerror = () => {
		if (source?.readyState === EventSource.CLOSED || source?.readyState === EventSource.CONNECTING) stop();
	};
}

function append(data: string): void {
	const next = [...chunks.value, { seq: ++seq, data }];
	chunks.value = next.length > MAX_CHUNKS ? next.slice(-MAX_CHUNKS) : next;
}

function stop(): void {
	source?.close();
	source = null;
	streaming.value = false;
}

watch(() => `${props.hostId}/${props.container.name}`, connect, { immediate: true });
onBeforeUnmount(stop);

useXterm(host, {
	chunks: () => chunks.value,
	interactive: () => false,
	background: () => '--ground-deep',
	onInput: () => undefined,
	onResize: () => undefined,
	onClear: () => (chunks.value = []),
});
</script>

<template>
	<div class="logs">
		<div class="toolbar">
			<span class="cmd mono" :title="props.container.command">{{ props.container.command }}</span>
			<span v-if="streaming" class="following">following</span>
			<button v-else type="button" class="btn" @click="connect">Reconnect</button>
			<button type="button" class="icon-btn icon-btn--ghost" aria-label="Clear logs" title="Clear (⌘K)" @click="chunks = []"><Icon name="clear" :size="14" /></button>
		</div>
		<div ref="host" class="terminal-host" />
	</div>
</template>

<style scoped>
.logs {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.toolbar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 2px 8px 2px 12px;
}

.cmd {
	flex: 1 1 120px;
	min-width: 0;
	font-size: 12px;
	color: var(--faint);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.following {
	font-size: 11px;
	color: var(--ok);
	margin-right: 4px;
}

.terminal-host {
	flex: 1;
	min-height: 0;
	min-width: 0;
	padding: 2px 0 4px 10px;
	overflow: hidden;
}

.terminal-host :deep(.xterm),
.terminal-host :deep(.xterm-viewport) {
	height: 100%;
}
</style>
