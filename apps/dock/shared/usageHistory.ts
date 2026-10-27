/** Recent CPU and memory samples, oldest first, for the live usage sparklines. */
export interface UsageHistory {
	/** CPU percentage per sample (100 = one core); null where none was read. */
	cpu: Array<number | null>;
	/** Memory in bytes per sample; null where none was read. */
	memory: Array<number | null>;
}

/** Samples kept per process or container: two to three minutes at Dock's intervals. */
export const HISTORY_LENGTH = 40;

/** @returns A history with no samples. */
export function emptyHistory(): UsageHistory {
	return { cpu: [], memory: [] };
}

/**
 * Appends one sample, dropping the oldest beyond {@link HISTORY_LENGTH}.
 *
 * @param history - Current history (not changed).
 * @param cpu - CPU percentage.
 * @param memory - Memory in bytes.
 * @returns The new history.
 */
export function pushSample(history: UsageHistory, cpu: number | null, memory: number | null): UsageHistory {
	return { cpu: [...history.cpu, cpu].slice(-HISTORY_LENGTH), memory: [...history.memory, memory].slice(-HISTORY_LENGTH) };
}
