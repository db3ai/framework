<script setup lang="ts">
import { ref } from 'vue';

import type { ProjectNavItem } from '../dock/projectNav.js';
import { useDesktop } from '../dock/useDesktop.js';
import Icon from './Icon.vue';
import ModalDialog from './ModalDialog.vue';
import type { ThemePreference } from '../dock/useLayout.js';
import ProjectSwitcher from './ProjectSwitcher.vue';
import ThemeMenu from './ThemeMenu.vue';

/** Top bar: sidebar toggle, project switcher, view switch and filter. */
const props = defineProps<{
	items: ProjectNavItem[];
	current: string;
	subtitle: string;
	view: 'list' | 'terminals';
	sidebarCollapsed: boolean;
	connected: boolean;
}>();

const filter = defineModel<string>('filter', { required: true });
const theme = defineModel<ThemePreference>('theme', { required: true });

const emit = defineEmits<{
	toggleSidebar: [];
	pick: [id: string];
	view: [view: 'list' | 'terminals'];
	addProject: [];
}>();

const desktop = useDesktop();
const showInstall = ref(false);

async function openDesktop(): Promise<void> {
	if (!desktop.installed.value) await desktop.refresh();
	if (desktop.installed.value) await desktop.open();
	else showInstall.value = true;
}
</script>

<template>
	<header class="header">
		<div class="left">
			<button
				type="button"
				class="icon-btn"
				:aria-label="props.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
				:aria-expanded="!props.sidebarCollapsed"
				@click="emit('toggleSidebar')"
			><Icon name="sidebar" /></button>
			<ProjectSwitcher :items="props.items" :current="props.current" :subtitle="props.subtitle" @pick="emit('pick', $event)" @add-project="emit('addProject')" />
		</div>
		<div class="segmented" role="group" aria-label="View">
			<button type="button" :aria-pressed="props.view === 'list'" :class="{ on: props.view === 'list' }" @click="emit('view', 'list')"><Icon name="list" :size="14" /> List</button>
			<button type="button" :aria-pressed="props.view === 'terminals'" :class="{ on: props.view === 'terminals' }" @click="emit('view', 'terminals')"><Icon name="grid" :size="14" /> Terminals</button>
		</div>
		<div class="right">
			<span v-if="!props.connected" class="offline" role="status">Reconnecting…</span>
			<label class="search">
				<Icon name="search" :size="15" />
				<span class="visually-hidden">Filter processes</span>
				<input v-model="filter" type="search" placeholder="Filter processes">
			</label>
			<span v-if="desktop.message.value" class="desktop-note" role="status">{{ desktop.message.value }}</span>
			<button v-if="desktop.available" type="button" class="btn add" :disabled="desktop.opening.value" title="Open Dock as a desktop app" @click="openDesktop"><Icon name="external" :size="14" /> Desktop app</button>
			<button type="button" class="btn add" @click="emit('addProject')"><Icon name="plus" :size="14" /> Add project</button>
			<ThemeMenu v-model="theme" />
		</div>
	</header>
	<ModalDialog v-if="showInstall" title="Install the desktop app" subtitle="One-time setup for the Electron shell" :width="560" @close="showInstall = false">
		<p class="install-text">The desktop app opens this same Dock in its own window, with its own Dock icon. Install it once from a terminal:</p>
		<pre class="install-cmd mono">{{ desktop.installCommand.value }}</pre>
		<p class="install-text">Then press <strong>Desktop app</strong> again.</p>
		<template #footer>
			<span class="spacer" />
			<button type="button" class="btn add" @click="showInstall = false">Close</button>
		</template>
	</ModalDialog>
</template>

<style scoped>
.header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px 20px;
	padding: 10px 16px;
	border-bottom: 1px solid var(--line);
	background: var(--bar);
}

.left {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}

.segmented {
	display: flex;
	padding: 3px;
	gap: 2px;
	border-radius: 9px;
	background: var(--ground);
	border: 1px solid var(--line);
}

.segmented button {
	height: 30px;
	padding: 0 12px;
	border-radius: 7px;
	border: 0;
	background: transparent;
	color: var(--muted);
	font-size: 13px;
	display: flex;
	align-items: center;
	gap: 6px;
}

.segmented button.on {
	background: var(--raised-hi);
	color: var(--text);
}

.right {
	flex: 1 1 240px;
	display: flex;
	justify-content: flex-end;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.offline {
	font-size: 12px;
	color: var(--warn);
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 36px;
	padding: 0 10px;
	flex: 0 1 260px;
	min-width: 160px;
	border-radius: 8px;
	border: 1px solid var(--line);
	background: var(--ground);
	color: var(--muted);
}

.search input {
	flex: 1;
	min-width: 0;
	background: transparent;
	border: 0;
	outline: none;
	color: var(--text);
	font-size: 13px;
}

.add {
	height: 36px;
	padding: 0 14px;
	font-size: 13px;
}

.desktop-note {
	font-size: 12px;
	color: var(--muted);
}

.install-text {
	margin: 0;
	font-size: 13px;
	line-height: 1.55;
	color: var(--text-2);
}

.install-cmd {
	margin: 0;
	padding: 12px 14px;
	border-radius: 10px;
	border: 1px solid var(--line);
	background: var(--ground-deep);
	font-size: 12.5px;
	white-space: pre-wrap;
	word-break: break-all;
	user-select: all;
}

.spacer {
	flex: 1;
}
</style>
