import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FLOW_MODELS } from '@db3.ai/app/flows';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { FlowExampleApp } from './FlowExampleApp';
import { createTextFlow } from './createTextFlow';

/** Drains only ready jobs, with an explicit finite guard for this small lab. */
async function drain(application: FlowExampleApp): Promise<void> {
	for (let jobs = 0; jobs < 20; jobs++) if (!await application.queue.processNextJob('flows')) return;
	throw new Error('Flow lab exceeded its 20-job safety limit.');
}

/** Runs a real durable graph, rejects invalid input and replays original/latest definitions. */
export async function runTextFlow() {
	const root = await mkdtemp(join(tmpdir(), 'db3-flow-guide-'));
	try {
		const database = await createGeneratedTestDatabase('flow_guide');
		const application = new FlowExampleApp({ db: database.db, queue: { queue: 'flows', retryDelaySeconds: 0, queueMonitor: false } }, root);
		try {
			await application.db.install(QueuedJob, FailedJob, ...FLOW_MODELS);
			const flow = createTextFlow();
			const stored = await application.flows.saveDefinition(flow);
			const original = await application.flows.run(flow.id, { text: '  Client note  ' });
			await drain(application);
			const originalDetails = await application.flows.runDetails(original.id!);
			const failed = await application.flows.run(flow.id, { text: '   ' });
			await drain(application);
			const failure = await application.flows.runDetails(failed.id!);
			const changed = structuredClone(flow);
			changed.blocks[1]!.config = { prefix: 'Updated: ' };
			await application.flows.saveDefinition(changed, { expectedRevision: stored.revision });
			const replay = await application.flows.replay(failed.id!, { definition: 'original', input: { text: 'Fixed note' } });
			const latest = await application.flows.replay(original.id!, { definition: 'latest' });
			await drain(application);
			const replayed = await application.flows.runDetails(replay.id!);
			const latestDetails = await application.flows.runDetails(latest.id!);
			return { status: originalDetails.run.status, output: originalDetails.run.output, steps: originalDetails.steps.length, logged: originalDetails.events.some(event => event.message === 'Note normalized'), failure: failure.run.status, failureMessage: failure.run.error?.message, repaired: replayed.run.output, latest: latestDetails.run.output, replayLinked: replayed.run.replayOf?.id === failed.id };
		} finally { try { await application.close(); } finally { await database.destroy(); } }
	} finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runTextFlow(), null, 2));
