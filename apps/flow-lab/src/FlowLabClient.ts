import type { FlowGraphDefinition, StoredFlowDefinition } from '@db3.ai/app/flows';
import type { FlowEditorCatalog, FlowEditorClient, FlowRunDetailsRecord, FlowRunPage, FlowRunRecord } from '@db3.ai/flow-designer';

/** Flow Lab's API, shaped for the flow editor. */
export const flowLabClient: FlowEditorClient = {
	catalog: () => request<FlowEditorCatalog>('/api/flows'),
	definition: id => request<StoredFlowDefinition>(`/api/flows/${encodeURIComponent(id)}`),
	save: (definition: FlowGraphDefinition, expectedRevision?: string) => request<StoredFlowDefinition>(`/api/flows/${encodeURIComponent(definition.id)}`, { method: 'PUT', body: JSON.stringify({ definition, expectedRevision }) }),
	runs: (flowId, query) => request<FlowRunPage>(`/api/flows/${encodeURIComponent(flowId)}/runs?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`),
	run: async (flowId, input) => (await request<{ run: FlowRunRecord }>(`/api/flows/${encodeURIComponent(flowId)}/runs`, { method: 'POST', body: JSON.stringify({ input }) })).run,
	runDetails: runId => request<FlowRunDetailsRecord>(`/api/flow-runs/${encodeURIComponent(runId)}`),
	replay: async (runId, definition) => (await request<{ run: FlowRunRecord }>(`/api/flow-runs/${encodeURIComponent(runId)}/replay`, { method: 'POST', body: JSON.stringify({ definition }) })).run,
};

/**
 * Performs one JSON API request and exposes backend error messages.
 *
 * @param url - API path.
 * @param options - Fetch request options.
 * @returns Parsed JSON response.
 */
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
	const body = await response.json().catch(() => ({})) as T & { message?: string };
	if (!response.ok) throw new Error(body.message || `Flow Lab request failed with status ${response.status}.`);
	return body;
}
