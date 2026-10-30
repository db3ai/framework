<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ConsoleScreens, httpConsoleSource } from '@db3.ai/console';

import type { ProjectDefinition } from '../../../shared/contracts.js';
import type { ThemePreference } from '../../dock/useLayout.js';
import '../../console.css';

/**
 * One project's console: its Database, Storage and Flows, which Dock's server opens from the
 * project's folder (its .env database, storage/app and db3/). These are the same screens db3
 * Cloud shows for a deployed environment.
 */
const props = defineProps<{ project: ProjectDefinition; theme: ThemePreference }>();
const tab = defineModel<'database' | 'storage' | 'flows' | 'agents'>('tab', { required: true });

const source = computed(() => httpConsoleSource(`/api/projects/${encodeURIComponent(props.project.id)}/console`));

// getdom.studio switches to dark on data-theme="dark", so "system" is resolved here.
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const systemDark = ref(query?.matches ?? false);
const onScheme = (event: MediaQueryListEvent) => { systemDark.value = event.matches; };
query?.addEventListener('change', onScheme);
onBeforeUnmount(() => query?.removeEventListener('change', onScheme));
const scheme = computed(() => props.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : props.theme);
</script>

<template>
	<div class="db3-console console-view" :data-theme="scheme">
		<ConsoleScreens :key="props.project.id" v-model:tab="tab" :source="source" />
	</div>
</template>

<style scoped>
.console-view {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: var(--panel);
}

.console-view > :deep(*) {
	flex: 1;
	min-height: 0;
}
</style>
