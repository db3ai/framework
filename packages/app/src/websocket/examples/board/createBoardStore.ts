import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { boardSnapshotSchema, type BoardSnapshot } from './boardSnapshot';

/** Authenticated HTTP actions supplied by the host; user identity is never a request-body parameter. */
export interface BoardApi {
	read(): Promise<unknown>;
	move(input: { cardId: string; column: 'todo' | 'doing' | 'done'; revision: number }): Promise<unknown>;
	start(requestId: string): Promise<unknown>;
}

/**
 * Creates a Pinia store for the selected board. Register once per application, with its HTTP adapter.
 * Install pinia and vue in the consuming browser app; neither is required by the backend runtime.
 */
export function createBoardStore(boardId: string, api: BoardApi) {
	return defineStore(`board:${boardId}`, () => {
		let active = true;
		const snapshot = ref<BoardSnapshot | null>(null);
		const submitting = ref(false);
		const error = ref<string | null>(null);
		const busy = computed(() => submitting.value || ['queued', 'running'].includes(snapshot.value?.activity?.status ?? ''));

		/** Validates the projection and ignores old responses arriving after a newer mutation. */
		function apply(value: unknown): void {
			if (!active) return;
			const next = boardSnapshotSchema.parse(value);
			if (next.id !== boardId) throw new Error('Wrong board snapshot.');
			if (!snapshot.value || next.revision >= snapshot.value.revision) snapshot.value = next;
			error.value = null;
		}

		/** Clears private data on failed authorization; the UI keeps an explicit retry/error state. */
		function fail(_cause: unknown): void { snapshot.value = null; error.value = 'Board unavailable. Reconnect or refresh to try again.'; }

		/** Applies the HTTP result immediately; a broadcast is only an extra refresh trigger. */
		async function move(cardId: string, column: 'todo' | 'doing' | 'done'): Promise<void> {
			if (!snapshot.value) return;
			try { apply(await api.move({ cardId, column, revision: snapshot.value.revision })); }
			catch (cause) { error.value = 'Save failed or conflicted. Refresh before retrying.'; throw cause; }
		}

		/**
		 * Shows immediate button feedback, then lets durable activity status own loading.
		 * Keep requestId across an uncertain response. On reload, GET restores the latest run.
		 */
		async function start(requestId: string): Promise<void> {
			if (busy.value || !snapshot.value) return;
			submitting.value = true;
			try { apply(await api.start(requestId)); }
			catch (cause) { error.value = 'Start outcome unknown. Refresh before retrying with the same request ID.'; throw cause; }
			finally { submitting.value = false; }
		}
		/** Fences late mutation responses and removes private state on logout or identity replacement. */
		function dispose(): void { active = false; snapshot.value = null; submitting.value = false; error.value = null; }
		return { snapshot, submitting, error, busy, apply, fail, move, start, dispose };
	});
}
