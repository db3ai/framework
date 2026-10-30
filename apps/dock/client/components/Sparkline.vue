<script setup lang="ts">
import { computed, ref } from 'vue';

import { formatAgo } from '../dock/presentation.js';
import { sparklineHoverIndex, sparklineShape } from '../dock/sparklineShape.js';

/**
 * A small live usage line, as on db3 Cloud's Developer tab; see {@link sparklineShape}.
 * Hovering shows the nearest sample through `format`, and how long ago it was taken when `times` are given.
 */
const props = withDefaults(defineProps<{ values: Array<number | null>; label: string; min?: number; max?: number | null; format?: (value: number) => string; times?: number[] }>(), {
	min: 1,
	max: null,
	format: (value: number) => String(value),
	times: undefined,
});

const WIDTH = 64;
const HEIGHT = 16;

const shape = computed(() => sparklineShape(props.values, { width: WIDTH, height: HEIGHT, min: props.min, max: props.max }));
const hover = ref<{ index: number; now: number } | null>(null);

function move(event: PointerEvent): void {
	const box = (event.currentTarget as Element).getBoundingClientRect();
	const index = box.width ? sparklineHoverIndex(props.values.length, (event.clientX - box.left) / box.width) : null;
	hover.value = index === null ? null : { index, now: Date.now() };
}

const tip = computed(() => {
	if (!hover.value) return null;
	const { index, now } = hover.value;
	const value = props.values[index];
	const point = shape.value.points[index];
	const at = props.times?.[index];
	const text = value === null || value === undefined ? 'No sample' : props.format(value);
	return { text: at === undefined ? text : `${text} · ${formatAgo(at, now)}`, point, left: `${((point?.x ?? 0) / WIDTH) * 100}%` };
});
</script>

<template>
	<span class="wrap" @pointermove="move" @pointerleave="hover = null">
		<svg class="spark" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="props.label" preserveAspectRatio="none">
			<line x1="0" :y1="HEIGHT - 0.5" :x2="WIDTH" :y2="HEIGHT - 0.5" class="base" />
			<path v-for="(area, index) in shape.areas" :key="`a${index}`" :d="area" class="area" />
			<polyline v-for="(line, index) in shape.lines" :key="`l${index}`" :points="line" class="line" />
			<circle v-if="tip?.point" :cx="tip.point.x" :cy="tip.point.y" r="1.6" class="dot" />
		</svg>
		<span v-if="tip" role="tooltip" class="tip" :style="{ left: tip.left }">{{ tip.text }}</span>
	</span>
</template>

<style scoped>
.wrap {
	position: relative;
	display: inline-flex;
	flex: none;
	cursor: crosshair;
}

.spark {
	width: 64px;
	height: 16px;
	color: inherit;
	overflow: visible;
}

.base {
	stroke: currentColor;
	stroke-opacity: 0.18;
}

.area {
	fill: currentColor;
	fill-opacity: 0.12;
}

.line {
	fill: none;
	stroke: currentColor;
	stroke-width: 1.25;
	stroke-linejoin: round;
	vector-effect: non-scaling-stroke;
}

.dot {
	fill: currentColor;
}

.tip {
	position: absolute;
	bottom: calc(100% + 4px);
	transform: translateX(-50%);
	z-index: 20;
	pointer-events: none;
	white-space: nowrap;
	padding: 2px 6px;
	border-radius: 4px;
	background: var(--menu);
	border: 1px solid var(--line-strong);
	box-shadow: 0 2px 8px var(--shadow);
	color: var(--text);
	font-size: 11px;
}
</style>
