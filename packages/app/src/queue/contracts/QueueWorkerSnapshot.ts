import type { QueueSelection } from './QueueSelection';

/** Process-scoped worker presence, independent of the queue transport and job payloads. */
export interface QueueWorkerSnapshot {
	id: string;
	name: string;
	hostname: string;
	pid: number;
	selection: QueueSelection;
	status: 'idle' | 'busy' | 'stopping' | 'stopped';
	currentQueue: string | null;
	currentJobId: string | null;
	startedAt: string;
	heartbeatAt: string;
}
