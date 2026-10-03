<script setup lang="ts">
import { computed } from 'vue';
import { inlineDocumentation } from '../inlineDocumentation';

const props = defineProps<{ text: string }>();
const parts = computed(() => inlineDocumentation(props.text));
</script>

<template>
	<template v-for="(part, index) in parts" :key="index"><code v-if="part.code" class="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-canvas-fg [overflow-wrap:anywhere]">{{ part.text }}</code><template v-else>{{ part.text }}</template></template>
</template>
