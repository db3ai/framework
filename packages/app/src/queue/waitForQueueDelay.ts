/**
 * Waits without accessing storage and resolves promptly on cancellation.
 * Uses the owning runtime clock so polling intervals remain testable.
 */
export async function waitForQueueDelay(intervalMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;
	await new Promise<void>(resolve => {
		const timer = setTimeout(finish, intervalMs);
		/** Releases the timer and listener on either timeout or shutdown. */
		function finish(): void {
			clearTimeout(timer);
			signal?.removeEventListener('abort', finish);
			resolve();
		}
		signal?.addEventListener('abort', finish, { once: true });
		if (signal?.aborted) finish();
	});
}
