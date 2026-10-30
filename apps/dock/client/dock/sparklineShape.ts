import { HISTORY_LENGTH } from '../../shared/usageHistory.js';

/** SVG geometry for a sparkline: one polyline and one filled area per unbroken run of samples. */
export interface SparklineShape {
	/** `points` attributes, one per run. */
	lines: string[];
	/** Area `d` attributes, one per run of two or more samples. */
	areas: string[];
	/** Where each sample is drawn, by index; null for a missing sample. */
	points: Array<{ x: number; y: number } | null>;
}

/** Options for {@link sparklineShape}. */
export interface SparklineOptions {
	width: number;
	height: number;
	/** Lowest top of the scale, so idle noise stays flat. */
	min: number;
	/** A known ceiling (such as a memory limit) that the scale should reach. */
	max?: number | null;
	/** Slots across the chart; samples fill from the right. */
	slots?: number;
}

/**
 * Lays out samples as a sparkline. Samples fill the right-hand slots, a null
 * sample breaks the line, and the scale leaves 20% headroom above the highest
 * value but never drops below `min`.
 *
 * @param values - Samples, oldest first.
 * @param options - Size and scale.
 * @returns Lines and areas in the chart's coordinates.
 */
export function sparklineShape(values: Array<number | null>, options: SparklineOptions): SparklineShape {
	const { width, height, min, max = null, slots = HISTORY_LENGTH } = options;
	const known = values.filter((value): value is number => value !== null);
	const top = Math.max(max ?? 0, min, ...known.map(value => value * 1.2));
	const step = width / (slots - 1);
	const offset = Math.max(0, slots - values.length);
	const runs: Array<Array<[number, number]>> = [[]];
	const points: SparklineShape['points'] = [];
	values.slice(-slots).forEach((value, index) => {
		if (value === null) {
			points.push(null);
			if (runs.at(-1)!.length) runs.push([]);
			return;
		}
		const xy: [number, number] = [(offset + index) * step, height - 1 - (Math.min(value, top) / top) * (height - 2)];
		points.push({ x: xy[0], y: xy[1] });
		runs.at(-1)!.push(xy);
	});
	const lines = runs.filter(run => run.length);
	const point = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
	return {
		lines: lines.map(run => run.map(point).join(' ')),
		points,
		areas: lines.filter(run => run.length > 1).map(run => `M${run[0]![0].toFixed(1)},${height} L${run.map(point).join(' L')} L${run.at(-1)![0].toFixed(1)},${height} Z`),
	};
}

/**
 * The sample under the pointer. Samples fill the right-hand slots, so the left of
 * a young history has none.
 *
 * @param count - Samples drawn.
 * @param fraction - Pointer position across the chart, 0 at the left edge and 1 at the right.
 * @param slots - Slots across the chart.
 * @returns Index into the samples, or null over an empty slot.
 */
export function sparklineHoverIndex(count: number, fraction: number, slots = HISTORY_LENGTH): number | null {
	const slot = Math.round(Math.min(1, Math.max(0, fraction)) * (slots - 1));
	const index = slot - (slots - Math.min(count, slots));
	return index >= 0 ? index : null;
}
