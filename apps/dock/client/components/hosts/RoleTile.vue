<script setup lang="ts">
import { computed } from 'vue';

import type { ContainerRole } from '../../../shared/hostContracts.js';
import { roleMeta } from '../../hosts/presentation.js';
import Icon from '../Icon.vue';

/** Coloured square with the icon for a container role, like a process's kind tile. */
const props = withDefaults(defineProps<{ role: ContainerRole; size?: 'sm' | 'md'; dimmed?: boolean }>(), { size: 'md', dimmed: false });

const meta = computed(() => roleMeta(props.role));
</script>

<template>
	<span
		class="tile"
		:class="[`tile--${props.size}`, { 'tile--dim': props.dimmed }]"
		:style="{ color: meta.color, background: meta.tint }"
		:title="meta.label"
	>
		<Icon :name="meta.icon" :size="props.size === 'sm' ? 13 : 17" />
	</span>
</template>

<style scoped>
.tile {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}

.tile--md {
	width: 34px;
	height: 34px;
	border-radius: 9px;
}

.tile--sm {
	width: 22px;
	height: 22px;
	border-radius: 6px;
}

.tile--dim {
	opacity: 0.5;
}
</style>
