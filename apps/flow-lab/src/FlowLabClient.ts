import type { FlowDefinition, FlowReplayDefinition, FlowValues, StoredFlowDefinition } from '@db3.ai/app/flows';
import type { FlowDesignerCatalog, FlowDesignerClient, FlowRunDetailsRecord, FlowRunRecord } from '@db3.ai/flow-designer';

/**
 * HTTP adapter connecting the reusable designer to the Flow Lab backend.
 */
export class FlowLabClient implements FlowDesignerClient {
	/**
	 * Loads flow summaries and executable block metadata.
	 *
	 * @returns Designer catalog.
	 */
	catalog(): Promise<FlowDesignerCatalog> {
		return request('/api/flows');
	}

	/**
	 * Loads one file-backed flow definition.
	 *
	 * @param id - Flow ULID.
	 * @returns Stored definition and revision metadata.
	 */
	definition(id: string): Promise<StoredFlowDefinition> {
		return request(`/api/flows/${encodeURIComponent(id)}`);
	}

	/**
	 * Saves one complete flow graph with optimistic revision protection.
	 *
	 * @param definition - Source-of-truth graph.
	 * @param expectedRevision - Revision loaded by the editor.
	 * @returns Persisted definition and new revision.
	 */
	save(definition: FlowDefinition, expectedRevision?: string): Promise<StoredFlowDefinition> {
		return request(`/api/flows/${encodeURIComponent(definition.id)}`, {
			method: 'PUT',
			body: JSON.stringify({
				definition,
				expectedRevision,
			}),
		});
	}

	/**
	 * Lists recent durable runs for one flow.
	 *
	 * @param flowId - Flow ULID.
	 * @returns Recent run records.
	 */
	async runs(flowId: string): Promise<FlowRunRecord[]> {
		const response = await request<{ runs: FlowRunRecord[] }>(`/api/flows/${encodeURIComponent(flowId)}/runs`);

		return response.runs;
	}

	/**
	 * Starts a durable flow run.
	 *
	 * @param flowId - Flow ULID.
	 * @param input - Public flow input.
	 * @returns Created run record.
	 */
	async run(flowId: string, input: FlowValues): Promise<FlowRunRecord> {
		const response = await request<{ run: FlowRunRecord }>(`/api/flows/${encodeURIComponent(flowId)}/runs`, {
			method: 'POST',
			body: JSON.stringify({ input }),
		});

		return response.run;
	}

	/**
	 * Loads a run with its steps and ordered events.
	 *
	 * @param runId - Durable run ULID.
	 * @returns Complete observable run state.
	 */
	runDetails(runId: string): Promise<FlowRunDetailsRecord> {
		return request(`/api/flow-runs/${encodeURIComponent(runId)}`);
	}

	/**
	 * Creates a linked replay from a historical run.
	 *
	 * @param runId - Historical run ULID.
	 * @param definition - Snapshot or latest definition source.
	 * @returns Created replay run.
	 */
	async replay(runId: string, definition: FlowReplayDefinition): Promise<FlowRunRecord> {
		const response = await request<{ run: FlowRunRecord }>(`/api/flow-runs/${encodeURIComponent(runId)}/replay`, {
			method: 'POST',
			body: JSON.stringify({ definition }),
		});

		return response.run;
	}
}

/**
 * Performs one JSON API request and exposes backend error messages.
 *
	 * @param url - Same-origin API URL.
	 * @param options - Fetch request options.
	 * @returns Parsed JSON response.
 */
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(url, {
		...options,
		headers: {
			accept: 'application/json',
			...(options.body ? { 'content-type': 'application/json' } : {}),
			...options.headers,
		},
	});
	const body = await response.json() as T & { message?: string };

	if (!response.ok) {
		throw new Error(body.message || `Flow Lab request failed with status ${response.status}.`);
	}

	return body;
}
