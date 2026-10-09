<script setup lang="ts">
import { computed } from 'vue';
import { FLOW_INPUT_BLOCK_TYPE } from '@db3.ai/app/flows/blocks';
import { ArrowRightToLine, Circle } from '@lucide/vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';

import type { FlowNodeData } from './FlowNodeData';

const props = defineProps<NodeProps<FlowNodeData>>();

const isInput = computed(() => props.data.instance.type === FLOW_INPUT_BLOCK_TYPE);
const ports = computed(() => isInput.value ? props.data.metadata.outputs : props.data.metadata.inputs);

/**
 * Returns the editable display label for one public boundary port.
 *
 * @param name - Stable public contract key.
 * @returns Editor label or the stable key when no label is configured.
 */
function portLabel(name: string): string {
	return ports.value[name]?.editor?.label || name;
}
</script>

<template>
	<div class="flow-boundary-node" :class="[{ 'is-input': isInput, 'is-output': !isInput, 'is-selected': selected }]">
		<header>
			<ArrowRightToLine :size="15" />
			<strong>{{ isInput ? 'Flow inputs' : 'Flow outputs' }}</strong>
		</header>

		<div class="flow-boundary-node__ports">
			<div v-for="(definition, name) in ports" :key="String(name)" class="flow-boundary-node__port">
				<Circle v-if="isInput" :size="12" aria-hidden="true" />
				<Handle
					v-if="!isInput"
					:id="String(name)"
					type="target"
					:position="Position.Left"
					:connectable="connectable"
				/>
				<span>{{ portLabel(String(name)) }}</span>
				<small>{{ definition.type }}</small>
				<Circle v-if="!isInput" :size="12" aria-hidden="true" />
				<Handle
					v-if="isInput"
					:id="String(name)"
					type="source"
					:position="Position.Right"
					:connectable="connectable"
				/>
			</div>
		</div>
	</div>
</template>
