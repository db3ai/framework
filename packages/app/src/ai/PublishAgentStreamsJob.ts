import { QueueableJob } from '@db3.ai/app/queue';
import { app } from '../server/appContext';

/** Repairs missed live publication after process/transport failures; never executes an agent. */
export class PublishAgentStreamsJob extends QueueableJob<Record<string, never>> {
	static jobName = 'PublishAgentStreamsJob';
	/** Uses the existing maintenance queue and scheduler rather than a per-token job. */
	constructor() { super({}); }
	/** Publishes committed changes before expiring old terminal replay. */
	async handle(): Promise<void> { await app().ai.conversations.publishPending(); await app().ai.conversations.prune(); }
}
