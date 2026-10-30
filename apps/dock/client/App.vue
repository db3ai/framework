<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, watchEffect } from 'vue';

import AddProcessDialog from './components/AddProcessDialog.vue';
import AddProjectDialog from './components/AddProjectDialog.vue';
import AppHeader from './components/AppHeader.vue';
import AddHostDialog from './components/hosts/AddHostDialog.vue';
import HostView from './components/hosts/HostView.vue';
import ProcessList from './components/ProcessList.vue';
import ProjectSidebar from './components/ProjectSidebar.vue';
import TerminalGrid from './components/TerminalGrid.vue';
import { provideDockContext } from './dock/context.js';
import { filterProjects } from './dock/filterProjects.js';
import { formatCores, formatMemory } from './dock/presentation.js';
import { hostNav, isRunning } from './hosts/presentation.js';
import { projectNav } from './dock/projectNav.js';
import { useDock } from './dock/useDock.js';
import { useLayout } from './dock/useLayout.js';

// The console (Database, Storage, Flows) loads on first use; it brings Tailwind and getdom.studio.
const ConsoleView = defineAsyncComponent(() => import('./components/console/ConsoleView.vue'));

const dock = useDock();
const layout = useLayout();
const filter = ref('');

// style.css switches colour-scheme on this attribute; `system` leaves it to prefers-color-scheme.
watchEffect(() => {
	document.documentElement.dataset.theme = layout.theme;
});
const addProcessFor = ref<string | null>(null);
const addingProject = ref(false);
const addingHost = ref(false);

provideDockContext({ dock, layout, openAddProcess: id => (addProcessFor.value = id) });

const navItems = computed(() => projectNav(dock.projects.value, dock.snapshots));
const serverItems = computed(() => hostNav(dock.hosts.value));
/** The server shown, when the current selection is `host:<id>`. */
const currentHost = computed(() => (layout.project.startsWith('host:') ? dock.hosts.value.find(host => `host:${host.id}` === layout.project) ?? null : null));
const visibleProjects = computed(() => filterProjects(dock.projects.value, layout.project, filter.value));
/** The one project the console view shows, when a single project is selected. */
const consoleProject = computed(() => dock.projects.value.find(project => project.id === layout.project) ?? null);
const addProcessProject = computed(() => dock.projects.value.find(project => project.id === addProcessFor.value) ?? null);

const subtitle = computed(() => {
	if (currentHost.value) {
		const host = currentHost.value;
		const engine = host.engine ? ` · ${formatCores(host.engine.cpus)} · ${formatMemory(host.engine.memory)}` : '';
		return `${host.containers.filter(isRunning).length} of ${host.containers.length} running · ${host.target}${engine}`;
	}
	const project = dock.projects.value.find(item => item.id === layout.project);
	const nav = navItems.value.find(item => item.id === layout.project);
	if (!project || !nav) return `${dock.runningCount.value} of ${dock.processCount.value} running`;
	return `${nav.running} of ${nav.total} running · ${project.path.replace(/^\/Users\/[^/]+/, '~')}`;
});

// A removed project or server falls back to "All projects".
watch([() => dock.projects.value, () => dock.hosts.value], ([projects, hosts]) => {
	if (layout.project === 'all' || !dock.loaded.value) return;
	// Hosts arrive just after projects; an empty list may not be loaded yet.
	const exists = layout.project.startsWith('host:')
		? !hosts.length || hosts.some(host => `host:${host.id}` === layout.project)
		: projects.some(project => project.id === layout.project);
	if (!exists) layout.project = 'all';
});

function pickProject(id: string): void {
	layout.project = id;
	layout.maximized = null;
}

function hostAdded(id: string): void {
	addingHost.value = false;
	layout.project = `host:${id}`;
}

function projectAdded(id: string, processId?: string): void {
	addingProject.value = false;
	layout.project = id;
	// A new app's setup terminal is shown so its install output and prompts are visible.
	if (processId) {
		layout.view = 'list';
		layout.selectedProcess = processId;
	}
}
</script>

<template>
	<div class="shell">
		<AppHeader
			v-model:filter="filter"
			v-model:theme="layout.theme"
			:items="[...navItems, ...serverItems]"
			:current="layout.project"
			:subtitle="subtitle"
			:view="layout.view"
			:sidebar-collapsed="layout.sidebarCollapsed"
			:connected="dock.connected.value || !dock.loaded.value"
			:show-views="!currentHost"
			:filter-label="currentHost ? 'Filter containers' : 'Filter processes'"
			@toggle-sidebar="layout.sidebarCollapsed = !layout.sidebarCollapsed"
			@pick="pickProject"
			@view="layout.view = $event"
			@add-project="addingProject = true"
		/>
		<div class="body" :class="{ 'body--rail': layout.sidebarCollapsed }">
			<ProjectSidebar :items="navItems" :servers="serverItems" :current="layout.project" :collapsed="layout.sidebarCollapsed" @pick="pickProject" @add-server="addingHost = true" />
			<main class="main">
				<p v-if="dock.error.value && !addingProject && !addingHost && !addProcessFor" class="banner" role="alert">
					{{ dock.error.value }}
					<button type="button" class="btn" @click="dock.clearError()">Dismiss</button>
				</p>
				<HostView v-if="currentHost" :key="currentHost.id" :host="currentHost" :filter="filter" />
				<div v-else-if="dock.loaded.value && !dock.projects.value.length" class="empty">
					<h1>Add your first project</h1>
					<p>Point Dock at a folder with a package.json. It picks up the <span class="mono">api</span>, <span class="mono">dev</span>, <span class="mono">queue</span> and <span class="mono">scheduler</span> scripts and runs each in its own terminal.</p>
					<button type="button" class="btn btn--primary" @click="addingProject = true">Add project</button>
				</div>
				<p v-else-if="dock.loaded.value && !visibleProjects.length" class="empty-filter">No processes match “{{ filter }}”.</p>
				<template v-else-if="layout.view === 'console'">
					<ConsoleView v-if="consoleProject" v-model:tab="layout.consoleTab" :project="consoleProject" :theme="layout.theme" />
					<p v-else class="empty-filter">Pick a project in the sidebar to open its Database, Storage and Flows.</p>
				</template>
				<ProcessList v-else-if="layout.view === 'list'" :projects="visibleProjects" />
				<TerminalGrid v-else :projects="visibleProjects" />
			</main>
		</div>
		<AddProcessDialog v-if="addProcessProject" :key="addProcessProject.id" :project="addProcessProject" @close="addProcessFor = null" />
		<AddHostDialog v-if="addingHost" @close="addingHost = false; dock.clearError()" @added="hostAdded" />
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
