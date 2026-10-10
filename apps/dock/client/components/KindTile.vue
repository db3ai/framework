<script setup lang="ts">
import { computed } from 'vue';

import type { ProcessKind } from '../../shared/contracts.js';
import { kindMeta } from '../dock/presentation.js';
import Icon from './Icon.vue';

/** Coloured square with the icon for a process kind. */
const props = withDefaults(defineProps<{ kind: ProcessKind; size?: 'sm' | 'md'; dimmed?: boolean }>(), { size: 'md', dimmed: false });

const meta = computed(() => kindMeta(props.kind));
</script>

<template>
	<span
		class="tile"
		:class="[`tile--${props.size}`, { 'tile--dim': props.dimmed }]"
		:style="{ color: meta.color, background: meta.tint }"
		:title="meta.label"
	>
		<Icon :name="meta.icon" :size="props.size === 'sm' ? 13 : 18" />
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
	width: 36px;
	height: 36px;
	border-radius: 9px;
}

.tile--sm {
	width: 22px;
	height: 22px;
	border-radius: 6px;
}

.tile--dim {
	opacity: 0.55;
}
</style>
