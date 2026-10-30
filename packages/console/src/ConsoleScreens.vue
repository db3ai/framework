<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ConsoleInfo } from '@db3.ai/app/console';
import DatabaseScreen from './DatabaseScreen.vue';
import FlowsScreen from './FlowsScreen.vue';
import StorageScreen from './StorageScreen.vue';
import type { ConsoleSource } from './source';

/**
 * The console for one app: Database, Storage and Flows tabs over one source. It asks the app what
 * it offers first, so a tab the app can't serve says why instead of failing.
 */
const props = defineProps<{ source: ConsoleSource }>();
const tab = defineModel<'database' | 'storage' | 'flows'>('tab', { default: 'database' });

const info = ref<ConsoleInfo | null>(null);
const error = ref('');

async function load() {
	try {
		info.value = await props.source.get<ConsoleInfo>('');
		error.value = '';
	} catch (cause) {
		info.value = null;
		error.value = cause instanceof Error ? cause.message : 'Could not reach the app.';
	}
}

const tabs = [['database', 'Database'], ['storage', 'Storage'], ['flows', 'Flows']] as const;
defineExpose({ reload: load });
watch(() => props.source, load, { immediate: true });
</script>

<template>
	<div class="flex h-full min-h-0 flex-col bg-canvas text-canvas-fg" data-console>
		<nav class="flex items-center gap-1 border-b border-border px-3" aria-label="Console">
			<button v-for="[key, label] in tabs" :key="key" type="button" class="-mb-px border-b-2 px-3 py-2 text-sm" :class="tab === key ? 'border-primary font-medium' : 'border-transparent text-muted-fg hover:text-canvas-fg'" :aria-current="tab === key ? 'page' : undefined" :data-console-tab="key" @click="tab = key">{{ label }}</button>
			<span v-if="info" class="ml-auto truncate text-xs text-muted-fg">{{ info.app }} · {{ info.environment }}</span>
		</nav>
		<div v-if="error" role="alert" class="m-4 flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" data-console-error>
			<span>{{ error }}</span>
			<button type="button" class="font-medium underline" @click="load">Try again</button>
		</div>
		<template v-else-if="info">
			<p v-if="!info[tab].available" class="m-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-fg" data-console-unavailable>{{ info[tab].reason }}</p>
			<DatabaseScreen v-else-if="tab === 'database'" class="min-h-0 flex-1" :source="source" :label="`${info.app}'s database`" />
			<StorageScreen v-else-if="tab === 'storage'" class="min-h-0 flex-1" :source="source" :read-only="info.readOnly?.rows" />
			<FlowsScreen v-else class="min-h-0 flex-1" :source="source" />
		</template>
	</div>
</template>
