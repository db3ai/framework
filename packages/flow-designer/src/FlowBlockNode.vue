<script setup lang="ts">
import { computed } from 'vue';
import { CircleDot, Layers3 } from '@lucide/vue';
import { Handle, Position, type NodeProps } from '@vue-flow/core';

import type { FlowNodeData } from './FlowNodeData';

const props = defineProps<NodeProps<FlowNodeData>>();

const statusLabel = computed(() => props.data.step?.status ?? 'not run');
const duration = computed(() => durationLabel(props.data.step?.startedAt, props.data.step?.completedAt));

/**
 * Formats the elapsed duration between two persisted timestamps.
 *
 * @param startedAt - Step start timestamp.
 * @param completedAt - Step completion timestamp.
 * @returns Compact elapsed duration or an empty string.
 */
function durationLabel(startedAt?: string | null, completedAt?: string | null): string {
	if (!startedAt) return '';

	const started = new Date(startedAt).getTime();
	const completed = completedAt ? new Date(completedAt).getTime() : Date.now();
	const milliseconds = Math.max(0, completed - started);

	return milliseconds < 1000
		? `${milliseconds}ms`
		: `${(milliseconds / 1000).toFixed(1)}s`;
}

/**
 * Returns the host-facing label for one named input or output port.
 *
 * @param name - Stable serialized port key.
 * @param direction - Port collection containing the display metadata.
 * @returns Editor label or the stable key.
 */
function portLabel(name: string, direction: 'inputs' | 'outputs'): string {
	return props.data.metadata[direction][name]?.editor?.label || name;
}
</script>

<template>
	<div
		class="flow-block-node"
		:class="[`is-${data.step?.status || 'idle'}`, { 'is-selected': selected }]"
	>
		<header class="flow-block-node__header">
			<span class="flow-block-node__icon" aria-hidden="true">
				<Layers3 v-if="data.instance.flowId" :size="15" />
				<CircleDot v-else :size="14" />
			</span>
			<span class="flow-block-node__title">{{ data.instance.name || data.metadata.name }}</span>
			<span class="flow-block-node__status">{{ statusLabel }}</span>
		</header>

		<div class="flow-block-node__type">{{ data.instance.flowId ? 'Nested flow' : data.instance.type }}</div>

		<div class="flow-block-node__ports">
			<div class="flow-block-node__port-column">
				<div
					v-for="(definition, name) in data.metadata.inputs"
					:key="`input-${name}`"
					class="flow-block-node__port is-input"
				>
					<Handle
						:id="String(name)"
						type="target"
						:position="Position.Left"
						:connectable="connectable"
					/>
					<span>{{ portLabel(String(name), 'inputs') }}</span>
					<small>{{ definition.type }}</small>
				</div>
			</div>

			<div class="flow-block-node__port-column">
				<div
					v-for="(definition, name) in data.metadata.outputs"
					:key="`output-${name}`"
					class="flow-block-node__port is-output"
				>
					<span>{{ portLabel(String(name), 'outputs') }}</span>
					<small>{{ definition.type }}</small>
					<Handle
						:id="String(name)"
						type="source"
						:position="Position.Right"
						:connectable="connectable"
					/>
				</div>
			</div>
		</div>

		<footer v-if="duration || data.step?.attempt" class="flow-block-node__footer">
			<span v-if="data.step?.attempt">Attempt {{ data.step.attempt }}</span>
			<span v-if="duration">{{ duration }}</span>
		</footer>
	</div>
</template>
