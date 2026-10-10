<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ProjectDefinition } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import { clampSize } from '../dock/splitSizes.js';
import ProcessRow from './ProcessRow.vue';
import SplitHandle from './SplitHandle.vue';
import ProjectActions from './ProjectActions.vue';
import TerminalPane from './TerminalPane.vue';

/** List view: one card per project, with the selected process's output docked below. */
const props = defineProps<{ projects: ProjectDefinition[] }>();

const { layout } = useDockContext();
const root = ref<HTMLElement | null>(null);
let dragStart = 0;

const PANEL_MIN = 120;
const CARDS_MIN = 140;

/** Dragging the panel's top edge up makes the panel taller. */
function resizePanel(delta: number): void {
	const available = root.value?.clientHeight ?? 800;
	layout.panelHeight = clampSize(dragStart - delta, PANEL_MIN, available - CARDS_MIN);
}

const selected = computed(() => {
	for (const project of props.projects) {
		const process = project.processes.find(item => item.id === layout.selectedProcess);
		if (process) return { project, process };
	}
	const project = props.projects.find(item => item.processes.length);
	return project ? { project, process: project.processes[0]! } : null;
});
</script>

<template>
	<div ref="root" class="list-view">
		<div class="cards">
			<section v-for="project in props.projects" :key="project.id" class="card" :aria-labelledby="`project-${project.id}`">
				<div class="card-head">
					<div class="title">
						<h2 :id="`project-${project.id}`">{{ project.name }}</h2>
						<span class="path mono">{{ project.path }}</span>
					</div>
					<ProjectActions :project="project" show-terminals />
				</div>
				<ProcessRow
					v-for="process in project.processes"
					:key="process.id"
					:process="process"
					:project-name="project.name"
					:selected="selected?.process.id === process.id"
					@select="layout.selectedProcess = process.id"
				/>
				<p v-if="!project.processes.length" class="none">No processes yet. Use <strong>Add process</strong> to run one of this project's npm scripts.</p>
			</section>
		</div>
		<SplitHandle
			v-if="selected"
			orientation="horizontal"
			label="Resize output panel"
			:value="layout.panelHeight"
			@start="dragStart = layout.panelHeight"
			@move="resizePanel"
			@reset="layout.panelHeight = 280"
		/>
		<div v-if="selected" class="dock-panel" :style="{ height: `${layout.panelHeight}px` }">
			<TerminalPane :key="selected.process.id" :process="selected.process" :project-name="selected.project.name" show-project />
		</div>
	</div>
</template>

<style scoped>
.list-view {
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
	gap: 20px;
}

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

.path {
	font-size: 12px;
	color: var(--muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.none {
	margin: 0;
	padding: 14px 16px;
	border-top: 1px solid var(--line-soft);
	color: var(--muted);
	font-size: 13px;
}

.dock-panel {
	flex: none;
	min-height: 0;
	/* A saved height never squeezes the cards away when the window is smaller. */
	max-height: calc(100% - 140px);
	display: flex;
	flex-direction: column;
}

.dock-panel > * {
	flex: 1;
}
</style>
