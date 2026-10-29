<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FlowBlockMetadata } from '@db3.ai/app/flows';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';

const props = defineProps<{ blocks: FlowBlockMetadata[] }>();
const emit = defineEmits<{ add: [type: string] }>();
const filter = ref<'All' | 'Triggers' | 'Actions'>('All');
const filters = ['All', 'Triggers', 'Actions'] as const;
const visible = computed(() => props.blocks.filter(block => filter.value === 'All'
	|| (filter.value === 'Triggers' ? block.kind === 'trigger'
		: block.kind !== 'trigger' && ![FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE].includes(block.type))));

/** Supplies the registered block type to the canvas drop handler without a graph mutation. */
function startDrag(event: DragEvent, type: string): void {
	if (!event.dataTransfer) return;
	event.dataTransfer.setData('application/x-platform-flow-block', type);
	event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
	<section>
		<h2>Blocks</h2>
		<div class="flow-palette-filters" role="group" aria-label="Filter blocks">
			<button v-for="option in filters" :key="option" type="button" :aria-pressed="filter === option" @click="filter = option">{{ option }}</button>
		</div>
		<button v-for="block in visible" :key="block.type" type="button" class="flow-library__block" draggable="true" :aria-label="`Add ${block.name}`" @dragstart="startDrag($event, block.type)" @click="emit('add', block.type)">
			<strong>{{ block.name }}</strong>
			<small>{{ block.kind === 'trigger' ? 'Trigger' : block.type }}</small>
		</button>
		<p v-if="!visible.length" class="flow-empty-copy">No {{ filter.toLowerCase() }} available.</p>
	</section>
</template>
