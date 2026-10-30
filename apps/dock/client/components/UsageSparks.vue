<script setup lang="ts">
import type { UsageHistory } from '../../shared/usageHistory.js';
import { formatMemory } from '../dock/presentation.js';
import Sparkline from './Sparkline.vue';

/** Live CPU and memory for a running process or container: a sparkline and the latest value for each. */
const props = defineProps<{ history: UsageHistory; cpu: number | null; memory: number | null; name: string }>();
</script>

<template>
	<span class="sparks">
		<span class="metric">
			<Sparkline :values="props.history.cpu" :times="props.history.at" :format="value => `CPU ${value.toFixed(1)}%`" :min="10" :label="`${props.name} CPU`" class="cpu" />
			<span class="value">{{ props.cpu === null ? '—' : `${props.cpu.toFixed(1)}%` }}</span>
		</span>
		<span class="metric">
			<Sparkline :values="props.history.memory" :times="props.history.at" :format="value => `Memory ${formatMemory(value)}`" :min="64 * 1024 * 1024" :label="`${props.name} memory`" class="memory" />
			<span class="value">{{ formatMemory(props.memory) }}</span>
		</span>
	</span>
</template>

<style scoped>
.sparks {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.metric {
	display: flex;
	align-items: center;
	gap: 8px;
}

.cpu {
	color: var(--link);
}

.memory {
	color: var(--kind-queue);
}

.value {
	white-space: nowrap;
}
</style>
