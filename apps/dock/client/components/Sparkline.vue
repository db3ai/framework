<script setup lang="ts">
import { computed } from 'vue';

import { sparklineShape } from '../dock/sparklineShape.js';

/** A small live usage line, as on db3 Cloud's Developer tab; see {@link sparklineShape}. */
const props = withDefaults(defineProps<{ values: Array<number | null>; label: string; min?: number; max?: number | null }>(), { min: 1, max: null });

const WIDTH = 64;
const HEIGHT = 16;

const shape = computed(() => sparklineShape(props.values, { width: WIDTH, height: HEIGHT, min: props.min, max: props.max }));
</script>

<template>
	<svg class="spark" :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" :aria-label="props.label" preserveAspectRatio="none">
		<line x1="0" :y1="HEIGHT - 0.5" :x2="WIDTH" :y2="HEIGHT - 0.5" class="base" />
		<path v-for="(area, index) in shape.areas" :key="`a${index}`" :d="area" class="area" />
		<polyline v-for="(line, index) in shape.lines" :key="`l${index}`" :points="line" class="line" />
	</svg>
</template>

<style scoped>
.spark {
	width: 64px;
	height: 16px;
	flex: none;
	color: var(--link);
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
</style>
