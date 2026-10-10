<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue';

import AddProcessDialog from './components/AddProcessDialog.vue';
import AddProjectDialog from './components/AddProjectDialog.vue';
import AppHeader from './components/AppHeader.vue';
import ProcessList from './components/ProcessList.vue';
import ProjectSidebar from './components/ProjectSidebar.vue';
import TerminalGrid from './components/TerminalGrid.vue';
import { provideDockContext } from './dock/context.js';
import { filterProjects } from './dock/filterProjects.js';
import { projectNav } from './dock/projectNav.js';
import { useDock } from './dock/useDock.js';
import { useLayout } from './dock/useLayout.js';

const dock = useDock();
const layout = useLayout();
const filter = ref('');

// style.css switches colour-scheme on this attribute; `system` leaves it to prefers-color-scheme.
watchEffect(() => {
	document.documentElement.dataset.theme = layout.theme;
});
const addProcessFor = ref<string | null>(null);
const addingProject = ref(false);

provideDockContext({ dock, layout, openAddProcess: id => (addProcessFor.value = id) });

const navItems = computed(() => projectNav(dock.projects.value, dock.snapshots));
const visibleProjects = computed(() => filterProjects(dock.projects.value, layout.project, filter.value));
const addProcessProject = computed(() => dock.projects.value.find(project => project.id === addProcessFor.value) ?? null);

const subtitle = computed(() => {
	const project = dock.projects.value.find(item => item.id === layout.project);
	const nav = navItems.value.find(item => item.id === layout.project);
	if (!project || !nav) return `${dock.runningCount.value} of ${dock.processCount.value} running`;
	return `${nav.running} of ${nav.total} running · ${project.path.replace(/^\/Users\/[^/]+/, '~')}`;
});

// A removed project falls back to "All projects".
watch(() => dock.projects.value, projects => {
	if (layout.project !== 'all' && dock.loaded.value && !projects.some(project => project.id === layout.project)) layout.project = 'all';
});

function pickProject(id: string): void {
	layout.project = id;
	layout.maximized = null;
}

function projectAdded(id: string): void {
	addingProject.value = false;
	layout.project = id;
}
</script>

<template>
	<div class="shell">
		<AppHeader
			v-model:filter="filter"
			v-model:theme="layout.theme"
			:items="navItems"
			:current="layout.project"
			:subtitle="subtitle"
			:view="layout.view"
			:sidebar-collapsed="layout.sidebarCollapsed"
			:connected="dock.connected.value || !dock.loaded.value"
			@toggle-sidebar="layout.sidebarCollapsed = !layout.sidebarCollapsed"
			@pick="pickProject"
			@view="layout.view = $event"
			@add-project="addingProject = true"
		/>
		<div class="body" :class="{ 'body--rail': layout.sidebarCollapsed }">
			<ProjectSidebar :items="navItems" :current="layout.project" :collapsed="layout.sidebarCollapsed" @pick="pickProject" />
			<main class="main">
				<p v-if="dock.error.value && !addingProject && !addProcessFor" class="banner" role="alert">
					{{ dock.error.value }}
					<button type="button" class="btn" @click="dock.clearError()">Dismiss</button>
				</p>
				<div v-if="dock.loaded.value && !dock.projects.value.length" class="empty">
					<h1>Add your first project</h1>
					<p>Point Dock at a folder with a package.json. It picks up the <span class="mono">api</span>, <span class="mono">dev</span>, <span class="mono">queue</span> and <span class="mono">scheduler</span> scripts and runs each in its own terminal.</p>
					<button type="button" class="btn btn--primary" @click="addingProject = true">Add project</button>
				</div>
				<p v-else-if="dock.loaded.value && !visibleProjects.length" class="empty-filter">No processes match “{{ filter }}”.</p>
				<ProcessList v-else-if="layout.view === 'list'" :projects="visibleProjects" />
				<TerminalGrid v-else :projects="visibleProjects" />
			</main>
		</div>
		<AddProcessDialog v-if="addProcessProject" :key="addProcessProject.id" :project="addProcessProject" @close="addProcessFor = null" />
		<AddProjectDialog v-if="addingProject" @close="addingProject = false; dock.clearError()" @added="projectAdded" />
	</div>
</template>

<style scoped>
.shell {
	height: 100%;
	display: flex;
	flex-direction: column;
}

.body {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-wrap: wrap;
	overflow: hidden;
}

.main {
	flex: 1 1 0;
	min-width: 0;
	min-height: 0;
	height: 100%;
	display: flex;
	flex-direction: column;
}

/* On narrow windows an expanded sidebar stacks above the content; the collapsed rail stays beside it. */
@media (max-width: 720px) {
	/* Stacked under an expanded sidebar, the body scrolls instead of the page. */
	.body:not(.body--rail) {
		overflow-y: auto;
	}

	.body:not(.body--rail) .main {
		flex-basis: 100%;
		height: auto;
	}
}

.banner {
	margin: 0;
	padding: 10px 16px;
	display: flex;
	align-items: center;
	gap: 12px;
	justify-content: space-between;
	background: color-mix(in srgb, var(--bad) 12%, transparent);
	border-bottom: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
	color: var(--bad);
	font-size: 13px;
}

.empty {
	margin: auto;
	max-width: 460px;
	padding: 24px;
	text-align: center;
	line-height: 1.6;
	color: var(--text-2);
}

.empty h1 {
	font-size: 20px;
	margin: 0 0 8px;
	color: var(--text);
}

.empty .btn {
	height: 40px;
	padding: 0 18px;
	font-size: 13px;
}

.empty-filter {
	margin: 24px;
	color: var(--muted);
}
</style>
