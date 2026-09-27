/** Executes a complete claimed-job attempt, including retries and hooks, inside its owner's lifecycle gate. */
export interface QueueJobRunner {
	<T>(operation: () => Promise<T>): Promise<T>;
}
