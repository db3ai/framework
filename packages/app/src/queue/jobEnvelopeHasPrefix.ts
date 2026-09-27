import type { SerializedQueuedJob } from './contracts';

/** Checks active work and nested chained continuations without inspecting application-owned payload data. */
export function jobEnvelopeHasPrefix(envelope: Pick<SerializedQueuedJob, 'job' | 'chained'>, prefix: string): boolean {
	return envelope.job.startsWith(prefix) || Boolean(envelope.chained?.some(job => jobEnvelopeHasPrefix(job, prefix)));
}
