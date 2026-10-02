import type { DocArticle } from '../docs';
import { frameworkAuthority } from '../generated/framework-authority';

const references = [
	['service', 'Dispatch, process and inspect', 'dist/queue/contracts/QueueService.d.ts'],
	['jobs', 'Job authoring and attempt context', 'dist/queue/QueueableJob.d.ts'],
	['job-context', 'Job hooks and restored instances', 'dist/queue/contracts/QueueableJob.d.ts'],
	['payload', 'Dispatch options and results', 'dist/queue/contracts/QueuePayload.d.ts'],
	['retry', 'Retry policy', 'dist/queue/contracts/QueueRetry.d.ts'],
	['worker', 'Worker lifecycle', 'dist/queue/contracts/QueueWorkerLifecycle.d.ts'],
	['selection', 'Worker queue selection', 'dist/queue/contracts/QueueSelection.d.ts'],
	['driver', 'Custom driver contract', 'dist/queue/contracts/QueueDriver.d.ts'],
	['redis', 'Redis options and cleanup', 'dist/queue/drivers/RedisQueueDriver.d.ts'],
	['redis-options', 'Redis connection settings', 'dist/queue/contracts/RedisQueueDriver.d.ts'],
	['events', 'Lifecycle events', 'dist/queue/contracts/QueueEvents.d.ts'],
	['console', 'Application CLI adapter', 'dist/queue/console.d.ts'],
] as const;
const sources: Readonly<Record<string, string>> = frameworkAuthority.declarationSources;

export const queueApiArticle: DocArticle = {
	id: 'queue-api', area: 'api', group: '@db3.ai/app', label: 'Queue API', title: 'Queue API reference',
	summary: 'Current emitted Queue contracts: options, job payloads, attempts, retries, workers, drivers and console integration.',
	packageName: '@db3.ai/app/queue', sourcePath: 'packages/app/src/queue/README.md', includeSourceDocument: false,
	declarationPaths: references.map(reference => reference[2]),
	sections: [{ id: 'start', title: 'Use the guide first', paragraphs: ['Import these public types and classes from `@db3.ai/app/queue`. The declarations below come from a freshly staged package, not copied signatures. Internal relative paths explain type dependencies; they are not supported deep imports.', 'Start with the guide for setup and executable examples. These signatures do not establish exactly-once delivery, atomic chains or ownership of your application processes.'], links: [{ label: 'Queue guide and report lab', articleId: 'queue-overview' }] }, ...references.map(([id, title]) => ({ id, title, paragraphs: [] as string[], codeSampleId: id }))],
	codeSamples: references.map(([id, title, path]) => ({ id, title, language: 'typescript', code: sources[path] ?? '' })),
	relatedIds: ['queue-overview', 'example-queue'], keywords: ['QueueOptions DispatchOptions QueueDriver QueueWorker QueueableJob contracts reference'],
};
