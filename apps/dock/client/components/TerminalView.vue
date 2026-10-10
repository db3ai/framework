<script setup lang="ts">
import { ref, watch } from 'vue';

import { useDockContext } from '../dock/context.js';
import { useXterm } from '../terminal/useXterm.js';

/**
 * A real terminal for one process (xterm.js): click into it and type, as in
 * VS Code or Cursor. Read-only while the process is stopped or runs outside Dock.
 */
const props = defineProps<{ processId: string; interactive: boolean; crashed: boolean }>();

const { dock } = useDockContext();
const host = ref<HTMLElement | null>(null);

watch(() => props.processId, id => dock.loadOutput(id), { immediate: true });

const terminal = useXterm(host, {
	chunks: () => dock.chunksOf(props.processId),
	interactive: () => props.interactive,
	background: () => (props.crashed ? '--crashed' : '--ground-deep'),
	onInput: data => dock.input(props.processId, data),
	onResize: (cols, rows) => dock.resize(props.processId, cols, rows),
	onClear: () => void dock.clear(props.processId),
});

defineExpose({ focus: terminal.focus });
</script>

<template>
	<div ref="host" class="terminal-host" />
</template>

<style scoped>
.terminal-host {
	flex: 1;
	min-height: 0;
	min-width: 0;
	padding: 6px 0 4px 10px;
	overflow: hidden;
}

/* xterm measures its grid from the host; let its viewport fill it. */
.terminal-host :deep(.xterm),
.terminal-host :deep(.xterm-viewport) {
	height: 100%;
}
</style>
