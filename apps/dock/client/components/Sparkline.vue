<script setup lang="ts">
import { computed } from 'vue';

import { HISTORY_LENGTH } from '../../shared/usageHistory.js';

/**
 * A small live usage line, as on db3 Cloud's Developer tab. Samples fill from the
 * right, with gaps where none was read. The scale leaves headroom above the
 * highest value and never drops below `min`, so idle noise stays flat.
 */
const props = withDefaults(defineProps<{ values: Array<number | null>; label: string; min?: number; max?: number | null }>(), { min: 1, max: null });

const WIDTH = 64;
const HEIGHT = 16;

const shape = computed(() => {
	const known = props.values.filter((value): value is number => value !== null);
	const top = Math.max(props.max ?? 0, props.min, ...known.map(value => value * 1.2));
	const step = WIDTH / (HISTORY_LENGTH - 1);
	const offset = HISTORY_LENGTH - props.values.length;
	const runs: string[][] = [[]];
	props.values.forEach((value, index) => {
		if (value === null) {
			if (runs.at(-1)!.length) runs.push([]);
			return;
		}
		const y = HEIGHT - 1 - (Math.min(value, top) / top) * (HEIGHT - 2);
		runs.at(-1)!.push(`${((offset + index) * step).toFixed(1)},${y.toFixed(1)}`);
	});
	const lines = runs.filter(run => run.length);
	return {
		lines: lines.map(run => run.join(' ')),
		areas: lines.filter(run => run.length > 1).map(run => `M${run[0]!.split(',')[0]},${HEIGHT} L${run.join(' L')} L${run.at(-1)!.split(',')[0]},${HEIGHT} Z`),
	};
});
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
