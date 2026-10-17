import type { AddProcessRequest, CreateAppRequest, CreateAppResult, OutputChunk, PackageScript, ProcessSnapshot, ProjectDefinition, QueueTopology } from '../shared/contracts.js';
import type { AddHostRequest, ContainerAction, HostDefinition } from '../shared/hostContracts.js';

/** Error with the server's message. */
export class DockApiError extends Error {
	constructor(message: string, readonly status: number) {
		super(message);
		this.name = 'DockApiError';
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: body === undefined ? undefined : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new DockApiError((data as { error?: string }).error ?? `Request failed (${response.status}).`, response.status);
	return data as T;
}

/** Thin client for the Dock HTTP API. */
export const dockApi = {
	addProject: (path: string, name?: string) => request<ProjectDefinition>('POST', '/api/projects', { path, name }),
	createApp: (body: CreateAppRequest) => request<CreateAppResult>('POST', '/api/projects/create', body),
	removeProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
	projectAction: (id: string, action: 'start' | 'stop' | 'restart' | 'open-editor') => request<{ ok: true }>('POST', `/api/projects/${encodeURIComponent(id)}/${action}`),
	scripts: (id: string) => request<{ scripts: PackageScript[] }>('GET', `/api/projects/${encodeURIComponent(id)}/scripts`),
	queues: (id: string) => request<QueueTopology>('GET', `/api/projects/${encodeURIComponent(id)}/queues`),
	addProcesses: (id: string, body: AddProcessRequest) => request<{ processes: ProcessSnapshot[] }>('POST', `/api/projects/${encodeURIComponent(id)}/processes`, body),
	removeProcess: (id: string) => request<{ ok: true }>('DELETE', `/api/processes/${encodeURIComponent(id)}`),
	processAction: (id: string, action: 'start' | 'stop' | 'restart' | 'clear') => request<{ ok: true }>('POST', `/api/processes/${encodeURIComponent(id)}/${action}`),
	desktop: () => request<{ installed: boolean; installCommand: string }>('GET', '/api/desktop'),
	openDesktop: () => request<{ ok: true }>('POST', '/api/desktop/open'),
	addHost: (body: AddHostRequest) => request<HostDefinition>('POST', '/api/hosts', body),
	removeHost: (id: string) => request<{ ok: true }>('DELETE', `/api/hosts/${encodeURIComponent(id)}`),
	refreshHost: (id: string) => request<{ ok: true }>('POST', `/api/hosts/${encodeURIComponent(id)}/refresh`),
	containerAction: (hostId: string, name: string, action: ContainerAction) => request<{ ok: true }>('POST', `/api/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(name)}/${action}`),
	/** Server-sent log stream URL for a container. */
	logsUrl: (hostId: string, name: string, tail = 500) => `/api/hosts/${encodeURIComponent(hostId)}/containers/${encodeURIComponent(name)}/logs?tail=${tail}`,
	output: (id: string, after = 0) => request<{ chunks: OutputChunk[] }>('GET', `/api/processes/${encodeURIComponent(id)}/output?after=${after}`),
};
