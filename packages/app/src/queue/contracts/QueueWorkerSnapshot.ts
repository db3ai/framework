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
	/** Jobs that succeeded since the worker started. */
	processed: number;
	/** Jobs that failed for good since the worker started. */
	failed: number;
	/** When the latest job finished, whatever its outcome. */
	lastJobAt: string | null;
	startedAt: string;
	heartbeatAt: string;
}
