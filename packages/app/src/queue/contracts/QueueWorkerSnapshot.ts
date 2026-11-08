import type { QueueSelection } from './QueueSelection';

/** Worker presence, one per pool and process,, independent of the queue transport and job payloads. */
export interface QueueWorkerSnapshot {
	id: string;
	name: string;
	hostname: string;
	pid: number;
	selection: QueueSelection;
	status: 'idle' | 'busy' | 'stopping' | 'stopped';
	currentQueue: string | null;
	currentJobId: string | null;
	/** Slots running a job now; currentQueue and currentJobId show one of them. */
	busy: number;
	/** Execution slots in this worker; a pool reports all of its slots in one snapshot. */
	slots: number;
	/** Jobs that succeeded since the worker started. */
	processed: number;
	/** Jobs that failed for good since the worker started. */
	failed: number;
	/** When the latest job finished, whatever its outcome. */
	lastJobAt: string | null;
	startedAt: string;
	heartbeatAt: string;
}
