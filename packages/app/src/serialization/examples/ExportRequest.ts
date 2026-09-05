import type { Serializable } from '@db3.ai/app/serialization';

/** Durable, explicitly versioned application state for a bounded export. */
export interface ExportRequestState {
	/** Application contract version, separate from the framework envelope version. */
	version: 1;
	/** Validated scalar identity; the worker must authorize its own data reads. */
	ownerId: string;
	/** Maximum number of records requested for the export. */
	limit: number;
}

/** A registered root that validates the same state on direct and restored construction. */
export class ExportRequest implements Serializable<ExportRequestState> {
	readonly #state: ExportRequestState;
	/** Validates all state needed to recreate this request in a worker. */
	constructor(state: ExportRequestState) {
		if (!state || state.version !== 1 || typeof state.ownerId !== 'string' || !state.ownerId.trim() || !Number.isInteger(state.limit) || state.limit < 1 || state.limit > 100) throw new Error('ExportRequest requires version 1, an owner and limit 1–100.');
		this.#state = { version: 1, ownerId: state.ownerId.trim(), limit: state.limit };
	}
	/** Returns plain constructor state, never a request, connection or service. */
	toJSON(): ExportRequestState { return { ...this.#state }; }
	/** Demonstrates private state was initialized by the restored constructor. */
	label(): string { return `${this.#state.ownerId}:${this.#state.limit}`; }
}
