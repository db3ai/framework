<script setup lang="ts">
import type { ProjectDefinition } from '../../shared/contracts.js';
import { useDockContext } from '../dock/context.js';
import { isUp } from '../dock/presentation.js';
import { clampSize, resizeAdjacent } from '../dock/splitSizes.js';
import ProjectActions from './ProjectActions.vue';
import SplitHandle from './SplitHandle.vue';
import TerminalPane from './TerminalPane.vue';

/**
 * Terminals view: each project's processes as columns separated by 1px
 * dividers. Dragging a divider resizes the columns either side; with several
 * projects, dragging a project's bottom edge resizes its row. One pane can be
 * maximised to fill its project's row. Sizes are remembered.
 */
const props = defineProps<{ projects: ProjectDefinition[] }>();

const { dock, layout } = useDockContext();

const COLUMN_MIN = 240;
const ROW_MIN = 180;
const ROW_DEFAULT = 380;

const columnRows = new Map<string, HTMLElement>();
let columnDrag: { ids: string[]; widths: number[]; index: number } | null = null;
let rowDragStart = 0;

function runningIn(project: ProjectDefinition): number {
	return project.processes.filter(process => isUp(dock.snapshots.get(process.id))).length;
}

function toggleMaximize(id: string): void {
	layout.maximized = layout.maximized === id ? null : id;
}

function visible(project: ProjectDefinition) {
	const maximized = project.processes.find(process => process.id === layout.maximized);
	return maximized ? [maximized] : project.processes;
}

/** A column's flex weight; new columns take the average of their row so they arrive at a fair width. */
function weight(project: ProjectDefinition, id: string): number {
	const known = project.processes.map(process => layout.columnWidths[process.id]).filter((value): value is number => value !== undefined);
	return layout.columnWidths[id] ?? (known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 1);
}

function setColumnRow(projectId: string, element: unknown): void {
	if (element instanceof HTMLElement) columnRows.set(projectId, element);
	else columnRows.delete(projectId);
}

function startColumns(project: ProjectDefinition, index: number): void {
	const row = columnRows.get(project.id);
	if (!row) return;
	const panes = [...row.querySelectorAll<HTMLElement>(':scope > .col')];
	columnDrag = { ids: visible(project).map(process => process.id), widths: panes.map(pane => pane.getBoundingClientRect().width), index };
}

function moveColumns(delta: number): void {
	if (!columnDrag) return;
	const widths = resizeAdjacent(columnDrag.widths, columnDrag.index, delta, COLUMN_MIN);
	columnDrag.ids.forEach((id, position) => {
		layout.columnWidths[id] = Math.round(widths[position]!);
	});
}

function resetColumns(project: ProjectDefinition): void {
	for (const process of project.processes) delete layout.columnWidths[process.id];
}

function rowHeight(project: ProjectDefinition): number {
	return layout.projectHeights[project.id] ?? ROW_DEFAULT;
}

function moveRow(project: ProjectDefinition, delta: number): void {
	layout.projectHeights[project.id] = Math.round(clampSize(rowDragStart + delta, ROW_MIN, 4000));
}
</script>

<template>
	<div class="terminals" :class="{ 'terminals--single': props.projects.length === 1 }">
		<template v-for="project in props.projects" :key="project.id">
			<section
				class="project"
				:style="props.projects.length > 1 ? { height: `${rowHeight(project)}px` } : undefined"
				:aria-labelledby="`terms-${project.id}`"
			>
				<div class="bar">
					<h2 :id="`terms-${project.id}`">{{ project.name }}</h2>
					<span class="path mono">{{ project.path }}</span>
					<span class="count">{{ runningIn(project) }} of {{ project.processes.length }} running</span>
					<ProjectActions :project="project" class="bar-actions" />
				</div>
				<div v-if="project.processes.length" :ref="element => setColumnRow(project.id, element)" class="columns">
					<template v-for="(process, index) in visible(project)" :key="process.id">
						<SplitHandle
							v-if="index > 0"
							orientation="vertical"
							:label="`Resize ${visible(project)[index - 1]!.name} and ${process.name}`"
							@start="startColumns(project, index - 1)"
							@move="moveColumns"
							@end="columnDrag = null"
							@reset="resetColumns(project)"
						/>
						<TerminalPane
							class="col"
							:style="{ flexGrow: weight(project, process.id) }"
							:process="process"
							:project-name="project.name"
							can-maximize
							:maximized="layout.maximized === process.id"
							@toggle-maximize="toggleMaximize(process.id)"
						/>
					</template>
				</div>
				<p v-else class="none">No processes yet.</p>
			</section>
			<SplitHandle
				v-if="props.projects.length > 1"
				orientation="horizontal"
				:label="`Resize ${project.name} terminals`"
				:value="rowHeight(project)"
				@start="rowDragStart = rowHeight(project)"
				@move="moveRow(project, $event)"
				@reset="delete layout.projectHeights[project.id]"
			/>
		</template>
	</div>
</template>

<style scoped>
.terminals {
	flex: 1;
	min-height: 0;
	overflow: auto;
	display: flex;
	flex-direction: column;
	background: var(--ground-deep);
}

.project {
	display: flex;
	flex-direction: column;
	flex: none;
	min-height: 0;
}

.terminals--single .project {
	flex: 1;
}

.bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 14px;
	padding: 8px 12px;
	background: var(--bar);
	border-bottom: 1px solid var(--line);
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.path,
.count {
	font-size: 12px;
	color: var(--muted);
}

.bar-actions {
	margin-left: auto;
}

/* Columns share the row by weight; narrow windows scroll sideways rather than crush panes. */
.columns {
	flex: 1;
	min-height: 0;
	display: flex;
	overflow-x: auto;
}

.col {
	flex-shrink: 1;
	flex-basis: 0;
	min-width: 240px;
}

.none {
	margin: 0;
	padding: 14px 16px;
	color: var(--muted);
	font-size: 13px;
}
</style>
