/**
 * Moves the boundary between two neighbouring panes, keeping their combined size.
 *
 * @param sizes - Current pane sizes in pixels, in order.
 * @param index - The pane before the boundary; the boundary sits between `index` and `index + 1`.
 * @param delta - Pixels the boundary moves (positive grows `index`).
 * @param min - Smallest size either pane may take.
 * @returns New sizes; other panes are unchanged.
 */
export function resizeAdjacent(sizes: number[], index: number, delta: number, min: number): number[] {
	const before = sizes[index];
	const after = sizes[index + 1];
	if (before === undefined || after === undefined) return sizes;
	const pair = before + after;
	const floor = Math.min(min, pair / 2);
	const nextBefore = clampSize(before + delta, floor, pair - floor);
	const next = [...sizes];
	next[index] = nextBefore;
	next[index + 1] = pair - nextBefore;
	return next;
}

/**
 * @param value - Requested size.
 * @param min - Lower bound.
 * @param max - Upper bound; ignored when below `min`.
 * @returns The size within bounds.
 */
export function clampSize(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}
