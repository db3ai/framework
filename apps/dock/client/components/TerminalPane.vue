<script setup lang="ts">
import { computed } from 'vue';

import type { ProcessDefinition } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import { isUp, kindMeta, statusOf } from '../dock/presentation.js';
import Icon from './Icon.vue';
import KindTile from './KindTile.vue';
import TerminalView from './TerminalView.vue';

/**
 * One process's terminal: header with status and controls above a real terminal.
 */
const props = withDefaults(defineProps<{
	process: ProcessDefinition;
	projectName: string;
	/** Show the maximise toggle (terminals grid only). */
	canMaximize?: boolean;
	maximized?: boolean;
	/** Show the project name before the process name. */
	showProject?: boolean;
}>(), { canMaximize: false, maximized: false, showProject: false });

const emit = defineEmits<{ toggleMaximize: [] }>();

const { dock, now } = useDockContext();

const snapshot = computed(() => dock.snapshots.get(props.process.id));
const status = computed(() => statusOf(snapshot.value, now.value));
const up = computed(() => isUp(snapshot.value));
const fullName = computed(() => `${props.projectName} · ${props.process.name}`);
const link = computed(() => (snapshot.value?.port ? dock.linkFor(snapshot.value.port) : null));
const otherPorts = computed(() => (snapshot.value?.ports ?? []).filter(port => port !== snapshot.value?.port));
/** Keystrokes reach the process only while it runs inside Dock. */
const interactive = computed(() => snapshot.value?.status === 'running' && !snapshot.value.external);
</script>

<template>
	<article
		class="pane"
		:class="{ 'pane--crashed': snapshot?.status === 'crashed' }"
		:style="{ borderTopColor: kindMeta(props.process.kind).color }"
		:aria-label="`Terminal: ${fullName}`"
	>
		<header class="head">
			<KindTile :kind="props.process.kind" size="sm" />
			<span class="name">
				<span v-if="props.showProject" class="project">{{ props.projectName }} ·</span>
				{{ props.process.name }}
			</span>
			<span class="dot" :class="`dot--${status.tone}`" />
			<span class="status" :class="`tone--${status.tone}`">{{ status.label }}</span>
			<a v-if="link" class="port mono" :href="link.href" :title="link.title" target="_blank" rel="noopener">{{ link.label }}</a>
			<a v-for="port in otherPorts" :key="port" class="port port--other mono" :href="`http://localhost:${port}/`" :title="`Also listening on :${port}`" target="_blank" rel="noopener">:{{ port }}</a>
			<span v-if="snapshot?.pid" class="pid mono">pid {{ snapshot.pid }}</span>
			<span v-if="snapshot?.external" class="external" title="Started in a terminal or editor. Restart to run it inside Dock with live output.">outside Dock</span>
			<div class="actions">
				<button type="button" class="icon-btn icon-btn--ghost" :aria-label="`Clear output of ${fullName}`" title="Clear (⌘K)" @click="dock.clear(props.process.id)"><Icon name="clear" :size="14" /></button>
				<button type="button" class="icon-btn icon-btn--ghost" :aria-label="`Restart ${fullName}${snapshot?.external ? ' inside Dock' : ''}`" :title="snapshot?.external ? 'Restart inside Dock' : 'Restart'" @click="dock.restart(props.process.id)"><Icon name="restart" :size="14" /></button>
				<button
					type="button"
					class="icon-btn icon-btn--ghost"
					:aria-label="`${up ? 'Stop' : 'Start'} ${fullName}`"
					:title="up ? 'Stop' : 'Start'"
					@click="up ? dock.stop(props.process.id) : dock.start(props.process.id)"
				><Icon :name="up ? 'stop' : 'play'" :size="13" /></button>
				<button
					v-if="props.canMaximize"
					type="button"
					class="icon-btn icon-btn--ghost"
					:aria-label="`${props.maximized ? 'Restore' : 'Maximise'} ${fullName}`"
					:aria-pressed="props.maximized"
					@click="emit('toggleMaximize')"
				><Icon :name="props.maximized ? 'minimize' : 'maximize'" :size="14" /></button>
			</div>
		</header>
		<TerminalView :process-id="props.process.id" :interactive="interactive" :crashed="snapshot?.status === 'crashed'" />
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

.pane--crashed {
	background: var(--crashed);
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
}

.project {
	color: var(--muted);
	font-weight: 500;
}

.status {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
}

.port,
.pid {
	font-size: 12px;
	text-decoration: none;
}

.pid {
	color: var(--faint);
}

.port--other {
	color: var(--muted);
}

.external {
	font-size: 11px;
	color: var(--warn);
	border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
	border-radius: 999px;
	padding: 1px 7px;
	white-space: nowrap;
}

.actions {
	margin-left: auto;
	display: flex;
	gap: 2px;
}




</style>
